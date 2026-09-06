const assert = require('assert');
const { _test } = require('../serverMetrics');

assert.strictEqual(_test.calculateCpuUsage({ idle: 100, total: 200 }, { idle: 125, total: 300 }), 75);

const mem = _test.parseMemInfo('MemTotal:       1000 kB\nMemAvailable:    400 kB\nSwapTotal:       200 kB\n');
assert.deepStrictEqual(mem, { MemTotal: 1024000, MemAvailable: 409600, SwapTotal: 204800 });

const cpuInfo = [
  'physical id\t: 0\ncore id\t\t: 0',
  'physical id\t: 0\ncore id\t\t: 0',
  'physical id\t: 0\ncore id\t\t: 1'
].join('\n\n');
assert.strictEqual(_test.parsePhysicalCoreCount(cpuInfo), 2);

const flat = _test.flattenBlockDevices([{ name: 'disk0', model: 'Safe Model', children: [{ name: 'disk0p1' }] }]);
assert.strictEqual(flat[1].model, 'Safe Model');

console.log('serverMetrics tests passed');
