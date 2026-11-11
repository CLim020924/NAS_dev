# NAS SSD 수명·안전 관리

이 문서는 현재 운영 조합인 GIGABYTE GP-AG4500G 500GB OS SSD와 Crucial
CT2000P3PSSD8 2TB 데이터 SSD의 수명 관리 기준을 정의한다. SMART의 전원 인가
시간은 수명 소모량이 아니며, `Percentage Used`, 누적 쓰기, 온도, 미디어 오류를
함께 판단한다.

## 안전 원칙

- `/mnt/nas`가 독립 마운트가 아니면 파일 작업을 503으로 차단한다. OS SSD의 빈
  `/mnt/nas` 디렉터리를 데이터 SSD로 오인해 쓰지 않는다.
- 데이터 SSD 이탈을 인증 실패나 파일 삭제로 처리하지 않는다. 마운트 복구 전까지
  원본 파일과 동기화 상태를 보존한다.
- `commit=60`, journald 전체 비활성화처럼 정전 시 손실과 진단 불능을 키우는
  수명 최적화는 사용하지 않는다.
- SMART 오류 로그 개수만으로 장애를 단정하지 않는다. Critical Warning,
  Percentage Used, Media and Data Integrity Errors와 증가 추세를 함께 확인한다.
- 디스크 장치명은 부팅마다 바뀔 수 있으므로 모델·용량·UUID·마운트를 함께 본다.

## 운영 보호 기능

- `NAS_REQUIRE_DEDICATED_MOUNT=true`가 기본값이며 Linux의 `/proc/self/mountinfo`로
  `/mnt/nas` 독립 마운트를 확인한다.
- 관리자 서버 설정은 SMART 상태, 수명 소모율, 누적 쓰기, 가동시간, 온도,
  비정상 종료와 미디어 오류를 표시한다.
- 데이터 마운트 누락 또는 SSD SMART 위험 상태는 새 관리 작업을 차단하고 MASTER
  알림을 만든다. 복구 시에도 한 번 알린다.
- SMART 조회는 5분 캐시하여 5초 UI 갱신과 30초 자원 표본 수집이 smartctl을
  반복 실행하지 않게 한다.
- fstrim.timer는 주 1회 enabled+active 상태를 유지한다.

## 현재 모델 기준

- GIGABYTE GP-AG4500G: 제조사 보증 내구도 850TBW.
- Crucial CT2000P3SSD8: 제조사 보증 내구도 440TBW.
- 보증 TBW 비율은 참고값이며 최종 건강 판정은 제조사 SMART Percentage Used를
  우선한다. 남은 연수를 임의로 예측해 표시하지 않는다.

## 점검 명령

```bash
findmnt -T /mnt/nas
lsblk -e7 -o NAME,MODEL,SERIAL,SIZE,FSTYPE,UUID,MOUNTPOINTS
sudo smartctl -a /dev/nvme0
sudo smartctl -a /dev/nvme1
systemctl status fstrim.timer
journalctl -u fstrim.service --since "60 days ago"
```

정상 조건은 `/mnt/nas`가 Crucial UUID
`5d6f2c61-121b-4ce1-afdb-37d0daf49941`에 연결되고, 두 SSD의 SMART가 PASSED,
Critical Warning 0, Media and Data Integrity Errors 0인 상태다.
