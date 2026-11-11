const assert = require('node:assert/strict');
const test = require('node:test');
const { _test } = require('../ssdHealth');

test('normalizes NVMe SMART health without exposing raw controller data', () => {
  const summary = _test.parseNvmeSmart({
    smart_status: { passed: true },
    nvme_smart_health_information_log: {
      critical_warning: 0,
      temperature: 32,
      available_spare: 100,
      percentage_used: 7,
      data_units_written: 73269395,
      power_on_hours: 8153,
      unsafe_shutdowns: 528,
      media_errors: 0,
      num_err_log_entries: 7650,
    },
  }, { device: '/dev/nvme0n1', model: 'GP-AG4500G' });

  assert.equal(summary.status, 'healthy');
  assert.equal(summary.remainingPercent, 93);
  assert.equal(summary.dataWrittenBytes, 73269395 * _test.NVME_DATA_UNIT_BYTES);
  assert.equal(summary.enduranceBytes, 850 * 1000 ** 4);
  assert.equal(Object.hasOwn(summary, 'serialNumber'), false);
});

test('classifies critical warning and media errors as critical', () => {
  const summary = _test.parseNvmeSmart({
    smart_status: { passed: true },
    nvme_smart_health_information_log: { critical_warning: 1, percentage_used: 2, media_errors: 1 },
  }, { device: '/dev/nvme1n1', model: 'CT2000P3PSSD8' });
  assert.equal(summary.status, 'critical');
});
