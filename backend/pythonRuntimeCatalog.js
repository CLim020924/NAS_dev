const RUNTIME_VERSION = '2026.09.07-1';
const DEFAULT_IMAGE = `msp-python-runtime:${RUNTIME_VERSION}`;

const PACKAGES = Object.freeze([
  { name: 'numpy', version: '2.5.3', imports: ['numpy'], category: '데이터·수치 계산' },
  { name: 'pandas', version: '3.0.5', imports: ['pandas'], category: '데이터·수치 계산' },
  { name: 'scipy', version: '1.18.1', imports: ['scipy'], category: '데이터·수치 계산' },
  { name: 'sympy', version: '1.14.0', imports: ['sympy'], category: '데이터·수치 계산' },
  { name: 'scikit-learn', version: '1.9.0', imports: ['sklearn'], category: '데이터·수치 계산' },
  { name: 'statsmodels', version: '0.15.0', imports: ['statsmodels'], category: '데이터·수치 계산' },
  { name: 'matplotlib', version: '3.11.1', imports: ['matplotlib'], category: '그래프' },
  { name: 'seaborn', version: '0.13.2', imports: ['seaborn'], category: '그래프' },
  { name: 'plotly', version: '7.0.0', imports: ['plotly'], category: '그래프' },
  { name: 'pillow', version: '12.3.0', imports: ['PIL'], category: '이미지·문서' },
  { name: 'openpyxl', version: '3.1.5', imports: ['openpyxl'], category: '이미지·문서' },
  { name: 'xlsxwriter', version: '3.2.9', imports: ['xlsxwriter'], category: '이미지·문서' },
  { name: 'python-docx', version: '1.2.0', imports: ['docx'], category: '이미지·문서' },
  { name: 'pypdf', version: '6.17.0', imports: ['pypdf'], category: '이미지·문서' },
  { name: 'reportlab', version: '5.0.1', imports: ['reportlab'], category: '이미지·문서' },
  { name: 'requests', version: '2.34.2', imports: ['requests'], category: 'HTTP·파싱' },
  { name: 'httpx', version: '0.28.1', imports: ['httpx'], category: 'HTTP·파싱' },
  { name: 'beautifulsoup4', version: '4.15.0', imports: ['bs4'], category: 'HTTP·파싱' },
  { name: 'lxml', version: '6.1.3', imports: ['lxml'], category: 'HTTP·파싱' },
  { name: 'python-dateutil', version: '2.9.0.post0', imports: ['dateutil'], category: '유틸리티' },
  { name: 'pytz', version: '2026.3.post1', imports: ['pytz'], category: '유틸리티' },
  { name: 'pyyaml', version: '6.0.3', imports: ['yaml'], category: '유틸리티' },
  { name: 'tqdm', version: '4.70.0', imports: ['tqdm'], category: '유틸리티' },
  { name: 'regex', version: '2026.9.3', imports: ['regex'], category: '유틸리티' },
  { name: 'sqlalchemy', version: '2.0.52', imports: ['sqlalchemy'], category: '유틸리티' },
]);

const getPythonRuntimeCatalog = () => ({
  runtimeVersion: RUNTIME_VERSION,
  pythonVersion: '3.12',
  packageCount: PACKAGES.length,
  packages: PACKAGES.map((item) => ({ ...item, imports: [...item.imports] })),
  execution: {
    network: 'none', persistentKernel: false, packageInstallDuringRun: false,
    memoryMiB: 512, timeoutSeconds: 15, readOnly: true,
  },
  externalPackages: {
    status: 'designed-not-enabled',
    message: '외부 패키지는 검증·고정·격리 설치 절차가 준비된 뒤 노트북별로 제공됩니다.',
  },
});

module.exports = { RUNTIME_VERSION, DEFAULT_IMAGE, PACKAGES, getPythonRuntimeCatalog };
