const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const SMART_CACHE_MS = 5 * 60 * 1000;
const DECIMAL_TB = 1000 ** 4;
const NVME_DATA_UNIT_BYTES = 512000;
const cache = new Map();

const ENDURANCE_BYTES_BY_MODEL = new Map([
  ['GP-AG4500G', 850 * DECIMAL_TB],
  ['CT2000P3PSSD8', 440 * DECIMAL_TB],
]);

const finiteNumber = (value, fallback = 0) => (
  value === null || value === undefined || value === ''
    ? fallback
    : Number.isFinite(Number(value)) ? Number(value) : fallback
);

const resolveEnduranceBytes = (model = '') => {
  const normalizedModel = String(model || '').trim().toUpperCase();
  for (const [modelToken, enduranceBytes] of ENDURANCE_BYTES_BY_MODEL) {
    if (normalizedModel.includes(modelToken.toUpperCase())) return enduranceBytes;
  }
  return null;
};

const parseNvmeSmart = (payload = {}, { device = '', model = '' } = {}) => {
  const log = payload.nvme_smart_health_information_log || {};
  const dataWrittenBytes = finiteNumber(log.data_units_written) * NVME_DATA_UNIT_BYTES;
  const enduranceBytes = resolveEnduranceBytes(model);
  const percentageUsed = Math.max(0, finiteNumber(log.percentage_used));
  const temperatureC = finiteNumber(log.temperature ?? payload.temperature?.current, null);
  const criticalWarning = finiteNumber(log.critical_warning);
  const mediaErrors = finiteNumber(log.media_errors);
  const healthPassed = payload.smart_status?.passed !== false;
  const status = !healthPassed || criticalWarning > 0 || mediaErrors > 0
    ? 'critical'
    : percentageUsed >= 80 || (temperatureC !== null && temperatureC >= 70)
      ? 'warning'
      : 'healthy';

  return {
    available: true,
    device,
    status,
    healthPassed,
    criticalWarning,
    temperatureC,
    availableSparePercent: finiteNumber(log.available_spare, null),
    percentageUsed,
    remainingPercent: Math.max(0, 100 - percentageUsed),
    dataWrittenBytes,
    enduranceBytes,
    enduranceUsedPercent: enduranceBytes ? Math.round((dataWrittenBytes / enduranceBytes) * 1000) / 10 : null,
    powerOnHours: finiteNumber(log.power_on_hours),
    unsafeShutdowns: finiteNumber(log.unsafe_shutdowns),
    mediaErrors,
    errorLogEntries: finiteNumber(log.num_err_log_entries),
    capturedAt: new Date().toISOString(),
  };
};

const parseSmartctlOutput = (stdout, context) => parseNvmeSmart(JSON.parse(String(stdout || '{}')), context);

const readNvmeSmart = async (disk = {}) => {
  const name = String(disk.name || '');
  if (!/^nvme\d+n\d+$/.test(name)) return { available: false, status: 'unsupported' };
  const cached = cache.get(name);
  if (cached && Date.now() - cached.at < SMART_CACHE_MS) return cached.value;

  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('smartctl', ['-Aj', `/dev/${name}`], { timeout: 5000, maxBuffer: 1024 * 1024 }));
  } catch (error) {
    stdout = error.stdout || '';
    if (!stdout) {
      const unavailable = { available: false, status: 'unavailable', capturedAt: new Date().toISOString() };
      cache.set(name, { at: Date.now(), value: unavailable });
      return unavailable;
    }
  }

  try {
    const value = parseSmartctlOutput(stdout, { device: `/dev/${name}`, model: disk.model });
    cache.set(name, { at: Date.now(), value });
    return value;
  } catch (error) {
    const invalid = { available: false, status: 'unavailable', capturedAt: new Date().toISOString() };
    cache.set(name, { at: Date.now(), value: invalid });
    return invalid;
  }
};

const enrichPhysicalDisks = async (disks = []) => Promise.all(disks.map(async (disk) => ({
  ...disk,
  smart: await readNvmeSmart(disk),
})));

module.exports = {
  enrichPhysicalDisks,
  _test: { parseNvmeSmart, parseSmartctlOutput, ENDURANCE_BYTES_BY_MODEL, NVME_DATA_UNIT_BYTES },
};
