const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagedPythonWorker } = require('../managedPythonWorker');
const { createManagedJavaScriptWorker } = require('../managedJavaScriptWorker');

const enabled = process.env.NAS_TEST_CODE_RUNTIME === '1';
const packageSmokeEnabled = enabled && process.env.NAS_TEST_PYTHON_PACKAGES === '1';

test('real Python sandbox executes a one-shot program', { skip: !enabled }, async () => {
  const result = await createManagedPythonWorker().run({ code: 'print(6 * 7)' });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), '42');
});

test('real JavaScript sandbox executes a one-shot program', { skip: !enabled }, async () => {
  const result = await createManagedJavaScriptWorker().run({ code: 'console.log(6 * 7)' });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), '42');
});

test('curated Python packages import and compute inside the real sandbox', { skip: !packageSmokeEnabled }, async () => {
  const code = `
import io
import json
import bs4, dateutil, docx, httpx, lxml, matplotlib, numpy, openpyxl
import pandas, PIL, plotly, pypdf, pytz, regex, reportlab, requests
import scipy, seaborn, sklearn, sqlalchemy, statsmodels, sympy, tqdm, xlsxwriter, yaml
matplotlib.use('Agg')
from matplotlib import pyplot as plt
frame = pandas.DataFrame({'value': numpy.array([1, 2, 3])})
figure = plt.figure()
plt.plot(frame['value'])
output = io.BytesIO()
figure.savefig(output, format='png')
print(json.dumps({'sum': int(frame['value'].sum()), 'png': len(output.getvalue()) > 100}))
`;
  const result = await createManagedPythonWorker({ memoryBytes: 512 * 1024 * 1024 }).run({ code });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { sum: 6, png: true });
});
