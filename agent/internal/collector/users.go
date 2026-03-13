package collector

import (
	"os/exec"
	"strings"
)

type UserInfo struct {
	Username  string `json:"username"`
	Terminal  string `json:"terminal,omitempty"`
	LoginTime string `json:"loginTime,omitempty"`
}

func CollectUsers() []UserInfo {
	out, err := exec.Command("who").Output()
	if err != nil {
		return nil
	}

	var users []UserInfo
	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}

		loginTime := ""
		if len(fields) >= 4 {
			loginTime = fields[2] + " " + fields[3]
		}

		users = append(users, UserInfo{
			Username:  fields[0],
			Terminal:  fields[1],
			LoginTime: loginTime,
		})
	}

	return users
}
