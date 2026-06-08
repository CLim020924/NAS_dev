package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const ServerBase = "https://filemanager-nas.com"
const MaxBytes int64 = 90 * 1024 * 1024

type RegisterResponse struct {
	Success    bool   `json:"success"`
	Status     string `json:"status"`
	Message    string `json:"message"`
	AgentToken string `json:"agentToken"`
	Device     struct {
		DeviceID      string `json:"deviceId"`
		LinkedNasPath string `json:"linkedNasPath"`
		Name          string `json:"name"`
		DeviceName    string `json:"deviceName"`
	} `json:"device"`
	Error string `json:"error"`
}

func main() {
	fmt.Println("")
	fmt.Println("=============================================")
	fmt.Println(" NAS Sync Agent - Windows Desktop Sync")
	fmt.Println("=============================================")
	fmt.Println("")

	token := getPairingTokenFromExeName()
	if token == "" {
		fmt.Println("연동 토큰을 실행 파일 이름에서 찾지 못했습니다.")
		fmt.Println("파일명이 NAS-Sync-Agent_pair_xxx.exe 형태인지 확인하세요.")
		waitExit()
		os.Exit(1)
	}

	deviceName, _ := os.Hostname()
	if deviceName == "" {
		deviceName = "Windows-PC"
	}

	desktopPath, err := findDesktopPath()
	if err != nil {
		fmt.Println("바탕화면 경로를 찾지 못했습니다.")
		fmt.Println(err.Error())
		waitExit()
		os.Exit(1)
	}

	fmt.Println("서버:", ServerBase)
	fmt.Println("PC 이름:", deviceName)
	fmt.Println("바탕화면:", desktopPath)
	fmt.Println("")

	reg, err := registerDevice(token, deviceName, desktopPath)
	if err != nil {
		fmt.Println("연동 등록 실패")
		fmt.Println(err.Error())
		waitExit()
		os.Exit(1)
	}

	fmt.Println("")
	fmt.Println("연동 감지!")
	if reg.Device.LinkedNasPath != "" {
		fmt.Println("NAS 폴더:", reg.Device.LinkedNasPath)
	}
	fmt.Println("")

	uploaded, skipped, failed := syncDesktopFiles(desktopPath, reg.Device.DeviceID, reg.AgentToken)

	fmt.Println("")
	fmt.Println("=============================================")
	fmt.Println("동기화 완료")
	fmt.Println("업로드:", uploaded)
	fmt.Println("건너뜀:", skipped)
	fmt.Println("실패:", failed)
	fmt.Println("=============================================")
	fmt.Println("")

	waitExit()
}

func waitExit() {
	fmt.Println("")
	fmt.Println("Enter를 누르면 종료합니다.")
	fmt.Scanln()
}

func getPairingTokenFromExeName() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}

	base := filepath.Base(exe)
	idx := strings.Index(base, "pair_")
	if idx < 0 {
		return ""
	}

	token := base[idx:]
	token = strings.TrimSuffix(token, ".exe")
	token = strings.TrimSuffix(token, ".EXE")

	if cut := strings.Index(token, " "); cut > 0 {
		token = token[:cut]
	}
	if cut := strings.Index(token, "("); cut > 0 {
		token = token[:cut]
	}

	return token
}

func findDesktopPath() (string, error) {
	candidates := []string{}

	if oneDrive := os.Getenv("OneDrive"); oneDrive != "" {
		candidates = append(candidates, filepath.Join(oneDrive, "Desktop"))
		candidates = append(candidates, filepath.Join(oneDrive, "바탕 화면"))
	}

	if oneDriveConsumer := os.Getenv("OneDriveConsumer"); oneDriveConsumer != "" {
		candidates = append(candidates, filepath.Join(oneDriveConsumer, "Desktop"))
		candidates = append(candidates, filepath.Join(oneDriveConsumer, "바탕 화면"))
	}

	if userProfile := os.Getenv("USERPROFILE"); userProfile != "" {
		candidates = append(candidates, filepath.Join(userProfile, "Desktop"))
		candidates = append(candidates, filepath.Join(userProfile, "바탕 화면"))
	}

	if home, err := os.UserHomeDir(); err == nil && home != "" {
		candidates = append(candidates, filepath.Join(home, "Desktop"))
		candidates = append(candidates, filepath.Join(home, "바탕 화면"))
	}

	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return p, nil
		}
	}

	return "", errors.New("Desktop 후보 경로를 모두 찾지 못했습니다.")
}

func registerDevice(pairingToken, deviceName, desktopPath string) (*RegisterResponse, error) {
	body := fmt.Sprintf(
		`{"pairingToken":%q,"deviceName":%q,"osType":"windows","desktopPath":%q}`,
		pairingToken,
		deviceName,
		desktopPath,
	)

	client := &http.Client{Timeout: 60 * time.Second}
	req, err := http.NewRequest("POST", ServerBase+"/api/devices/agent/register", strings.NewReader(body))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("서버 응답 오류: HTTP %d\n%s", resp.StatusCode, string(respBytes))
	}

	var parsed RegisterResponse
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return nil, err
	}

	if parsed.AgentToken == "" || parsed.Device.DeviceID == "" {
		return nil, fmt.Errorf("서버 등록 응답이 올바르지 않습니다.\n%s", string(respBytes))
	}

	return &parsed, nil
}

func syncDesktopFiles(desktopPath, deviceId, agentToken string) (int, int, int) {
	uploaded := 0
	skipped := 0
	failed := 0

	filepath.WalkDir(desktopPath, func(fullPath string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			failed++
			fmt.Println("[실패]", fullPath, walkErr.Error())
			return nil
		}

		if d.IsDir() {
			return nil
		}

		info, err := d.Info()
		if err != nil {
			failed++
			fmt.Println("[실패]", fullPath, err.Error())
			return nil
		}

		rel := toRelPath(desktopPath, fullPath)

		if info.Size() > MaxBytes {
			skipped++
			fmt.Println("[건너뜀 - 90MB 초과]", rel)
			return nil
		}

		fmt.Println("[업로드]", rel)

		if err := uploadFile(fullPath, rel, deviceId, agentToken); err != nil {
			failed++
			fmt.Println("[실패]", rel)
			fmt.Println("       ", err.Error())
			return nil
		}

		uploaded++
		return nil
	})

	return uploaded, skipped, failed
}

func toRelPath(root, fullPath string) string {
	rel, err := filepath.Rel(root, fullPath)
	if err != nil {
		return filepath.Base(fullPath)
	}

	return strings.ReplaceAll(rel, "\\", "/")
}

func uploadFile(fullPath, relPath, deviceId, agentToken string) error {
	pr, pw := io.Pipe()
	writer := multipart.NewWriter(pw)

	go func() {
		defer pw.Close()
		defer writer.Close()

		if err := writer.WriteField("deviceId", deviceId); err != nil {
			pw.CloseWithError(err)
			return
		}

		if err := writer.WriteField("relPath", relPath); err != nil {
			pw.CloseWithError(err)
			return
		}

		file, err := os.Open(fullPath)
		if err != nil {
			pw.CloseWithError(err)
			return
		}
		defer file.Close()

		part, err := writer.CreateFormFile("file", filepath.Base(fullPath))
		if err != nil {
			pw.CloseWithError(err)
			return
		}

		if _, err := io.Copy(part, file); err != nil {
			pw.CloseWithError(err)
			return
		}
	}()

	client := &http.Client{Timeout: 30 * time.Minute}
	req, err := http.NewRequest("POST", ServerBase+"/api/devices/agent/sync-file", pr)
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("x-agent-token", agentToken)

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBytes))
	}

	return nil
}
