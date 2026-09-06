const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
let previousCpuSample = null;

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value) * 10) / 10));

const readText = async (filePath) => {
  try {
    return (await fs.promises.readFile(filePath, 'utf8')).trim();
  } catch (err) {
    return '';
  }
};

const getCpuSnapshot = () => os.cpus().reduce((total, cpu) => {
  const times = cpu.times || {};
  const idle = Number(times.idle || 0);
  const all = Object.values(times).reduce((sum, value) => sum + Number(value || 0), 0);
  return { idle: total.idle + idle, total: total.total + all };
}, { idle: 0, total: 0 });

const calculateCpuUsage = (previous, current) => {
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) return 0;
  return clampPercent(((totalDelta - idleDelta) / totalDelta) * 100);
};

const getCpuUsagePercent = async () => {
  let before = previousCpuSample;
  if (!before) {
    before = getCpuSnapshot();
    await new Promise((resolve) => setTimeout(resolve, 160));
  }
  const current = getCpuSnapshot();
  previousCpuSample = current;
  return calculateCpuUsage(before, current);
};

const parseMemInfo = (content = '') => Object.fromEntries(
  String(content).split(/\r?\n/).map((line) => {
    const match = line.match(/^([^:]+):\s+(\d+)\s*kB$/);
    return match ? [match[1], Number(match[2]) * 1024] : null;
  }).filter(Boolean)
);

const parsePhysicalCoreCount = (content = '') => {
  const pairs = new Set();
  String(content).split(/\n\s*\n/).forEach((block) => {
    const physical = block.match(/^physical id\s*:\s*(.+)$/m)?.[1];
    const core = block.match(/^core id\s*:\s*(.+)$/m)?.[1];
    if (physical !== undefined && core !== undefined) pairs.add(`${physical}:${core}`);
  });
  return pairs.size || null;
};

const flattenBlockDevices = (devices = [], parentModel = '') => devices.flatMap((device) => {
  const model = String(device.model || parentModel || '').trim();
  const current = { ...device, model };
  return [current, ...flattenBlockDevices(device.children || [], model)];
});

const getBlockDevices = async () => {
  try {
    const { stdout } = await execFileAsync('lsblk', [
      '--json', '--bytes', '--output', 'NAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS,MODEL'
    ], { timeout: 4000, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(stdout);
    const flat = flattenBlockDevices(parsed.blockdevices || []);
    return {
      physical: (parsed.blockdevices || []).filter((item) => item.type === 'disk').map((item) => ({
        name: item.name,
        model: String(item.model || '').trim() || '알 수 없는 디스크',
        sizeBytes: Number(item.size || 0),
        type: String(item.name || '').startsWith('nvme') ? 'NVMe SSD' : '디스크'
      })),
      flat
    };
  } catch (err) {
    return { physical: [], flat: [] };
  }
};

const getFilesystemUsage = async (targetPath, purpose, flatDevices) => {
  const resolvedPath = path.resolve(targetPath);
  try {
    const stats = await fs.promises.statfs(resolvedPath);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const usedBytes = Math.max(0, totalBytes - (Number(stats.bfree) * Number(stats.bsize)));
    const mountDevice = flatDevices.find((device) => (device.mountpoints || []).includes(resolvedPath));
    return {
      purpose,
      mountPath: resolvedPath,
      device: mountDevice?.name ? `/dev/${mountDevice.name}` : '',
      model: mountDevice?.model || '',
      filesystem: mountDevice?.fstype || '',
      totalBytes,
      usedBytes,
      freeBytes,
      usedPercent: totalBytes ? clampPercent((usedBytes / totalBytes) * 100) : 0
    };
  } catch (err) {
    return null;
  }
};

const readSensorGroup = async (hwmonPath, hwmonName, prefix, unitDivisor, min, max) => {
  let entries = [];
  try { entries = await fs.promises.readdir(hwmonPath); } catch (err) { return []; }
  const inputFiles = entries.filter((name) => new RegExp(`^${prefix}\\d+_input$`).test(name));
  const readings = [];
  for (const inputFile of inputFiles) {
    const rawValue = Number(await readText(path.join(hwmonPath, inputFile)));
    const value = rawValue / unitDivisor;
    if (!Number.isFinite(value) || value < min || value > max) continue;
    const labelFile = inputFile.replace(/_input$/, '_label');
    const label = await readText(path.join(hwmonPath, labelFile));
    readings.push({
      source: hwmonName,
      label: label || `${hwmonName} ${inputFile.replace('_input', '')}`,
      value: Math.round(value * 10) / 10
    });
  }
  return readings;
};

const getHardwareSensors = async () => {
  const root = '/sys/class/hwmon';
  let hwmons = [];
  try { hwmons = await fs.promises.readdir(root); } catch (err) { return { temperatures: [], fans: [], power: { available: false, readings: [] } }; }

  const temperatures = [];
  const fans = [];
  const powerReadings = [];
  for (const hwmon of hwmons) {
    const hwmonPath = path.join(root, hwmon);
    const name = await readText(path.join(hwmonPath, 'name')) || hwmon;
    temperatures.push(...await readSensorGroup(hwmonPath, name, 'temp', 1000, -20, 150));
    fans.push(...await readSensorGroup(hwmonPath, name, 'fan', 1, 0, 100000));
    powerReadings.push(...await readSensorGroup(hwmonPath, name, 'power', 1000000, 0, 100000));
  }

  return {
    temperatures,
    fans,
    power: { available: powerReadings.length > 0, readings: powerReadings }
  };
};

const collectServerMetrics = async ({ nasRoot }) => {
  const [cpuUsagePercent, memText, cpuInfoText, blockDevices, sensors] = await Promise.all([
    getCpuUsagePercent(),
    readText('/proc/meminfo'),
    readText('/proc/cpuinfo'),
    getBlockDevices(),
    getHardwareSensors()
  ]);
  const mem = parseMemInfo(memText);
  const totalBytes = mem.MemTotal || os.totalmem();
  const availableBytes = mem.MemAvailable || os.freemem();
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const volumeTargets = [
    { path: '/', purpose: '시스템' },
    { path: nasRoot, purpose: 'NAS 데이터' }
  ];
  const seen = new Set();
  const volumes = (await Promise.all(volumeTargets.map((item) => getFilesystemUsage(item.path, item.purpose, blockDevices.flat))))
    .filter((item) => item && !seen.has(item.mountPath) && seen.add(item.mountPath));

  return {
    collectedAt: new Date().toISOString(),
    server: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      uptimeSeconds: Math.floor(os.uptime())
    },
    cpu: {
      model: os.cpus()[0]?.model?.trim() || '알 수 없음',
      physicalCores: parsePhysicalCoreCount(cpuInfoText),
      logicalCores: os.cpus().length,
      usagePercent: cpuUsagePercent,
      loadAverage: os.loadavg().map((value) => Math.round(value * 100) / 100)
    },
    memory: {
      totalBytes,
      usedBytes,
      availableBytes,
      usedPercent: totalBytes ? clampPercent((usedBytes / totalBytes) * 100) : 0,
      swapTotalBytes: mem.SwapTotal || 0,
      swapUsedBytes: Math.max(0, (mem.SwapTotal || 0) - (mem.SwapFree || 0))
    },
    disks: { physical: blockDevices.physical, volumes },
    temperatures: sensors.temperatures,
    fans: sensors.fans,
    power: sensors.power
  };
};

module.exports = {
  collectServerMetrics,
  _test: { calculateCpuUsage, parseMemInfo, parsePhysicalCoreCount, flattenBlockDevices }
};
