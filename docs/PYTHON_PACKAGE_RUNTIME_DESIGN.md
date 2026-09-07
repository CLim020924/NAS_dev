# Python 패키지 실행 환경

## 현재 제공 범위

Note Studio의 Python 코드는 `msp-python-runtime:2026.09.07-1` 이미지에서 매번 새 컨테이너로 실행한다. 표준 라이브러리와 함께 데이터 분석, 수치 계산, 그래프, 이미지·문서, HTTP·파싱, 날짜·유틸리티 계열의 직접 제공 패키지 25개를 포함한다. 정확한 버전은 `backend/python-runtime/requirements.lock`과 화면의 `패키지` 목록이 기준이다.

실행 컨테이너는 외부망, NAS 파일시스템, 호스트 환경변수와 인증정보에 접근하지 못한다. `requests`와 `httpx`는 로컬 문자열·응답 처리 코드에 사용할 수 있지만 현재 실행 중 외부 HTTP 요청은 차단된다. Matplotlib은 GUI 대신 `Agg` backend를 사용한다.

PyTorch, TensorFlow, CUDA, 브라우저 자동화, 대형 언어 모델은 기본 이미지에 포함하지 않는다. NAS의 CPU·RAM·디스크와 동시 사용자에 큰 영향을 주기 때문에 MASTER가 별도 실행 등급과 자원 한도를 승인해야 한다.

## 외부 패키지 설치 설계

사용자 코드에서 `pip install`을 직접 실행하거나 실행 컨테이너에 인터넷을 열지 않는다. 다음 흐름으로 제공한다.

1. 사용자가 노트북의 Python 환경 화면에서 PyPI 패키지 이름과 정확한 버전을 요청한다.
2. 서버는 PEP 503 정규 이름과 버전만 허용하고 Git URL, 로컬 경로, 직접 URL, private index, pip 옵션과 shell 문자를 거절한다.
3. 네트워크가 허용된 별도 builder 컨테이너가 공식 PyPI에서 wheel만 받는다. 소스 배포판과 설치 스크립트 build는 기본 거절한다.
4. resolver가 전이 의존성을 lock하고 모든 wheel의 SHA-256을 기록한다. 취약점 감사와 관리자 금지 목록을 통과하지 못하면 활성화하지 않는다.
5. lock hash를 키로 불변 실행 이미지를 만든다. 설치·검사 중에는 사용자 파일, NAS root, 서비스 비밀과 Docker socket을 mount하지 않는다.
6. 빌드가 성공한 뒤에만 해당 노트북의 runtime revision을 원자적으로 바꾼다. 실패하면 기존 런타임을 계속 사용한다.
7. 실제 코드 실행은 다시 network none, non-root, read-only, CPU/RAM/PID/time/output 제한을 적용한다. 외부 패키지는 신뢰할 수 있는 코드로 간주하지 않는다.

## 권한과 자원 정책

- 일반 사용자: 크기가 작은 pure-Python 또는 검증된 wheel 패키지를 노트북별 한도 안에서 요청한다.
- 관리자: 조직 allow/deny 목록과 저장 용량을 관리하되 GPU·CUDA·고부하 패키지 권한은 부여할 수 없다.
- MASTER: GPU·CUDA·대형 ML 실행 등급을 계정별로 승인하거나 회수한다.
- 동일 lock hash는 중복 설치하지 않고 서버 전체 캐시를 공유하되, 어떤 계정이 사용하는지는 별도 ACL로 관리한다.
- 설치 queue, 사용자별 동시 빌드 1건, 전역 동시 빌드 1건, 다운로드·압축 해제 크기, 빌드 시간, 디스크 여유 공간을 강제한다.

## 아직 열지 않는 기능

외부 패키지 self-service 설치는 설계만 확정했으며 현재 API와 UI에서 활성화하지 않는다. wheel 검증, lock/hash, 취약점 정책, 용량 회수, 실패 rollback과 관리자 화면을 한 번에 구현·검증한 뒤 공개한다. 이 경계를 갖추지 않은 임시 `pip install` 버튼은 추가하지 않는다.
