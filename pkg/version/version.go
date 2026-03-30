package version

import "fmt"

type Info struct {
	Version     string `json:"version"`
	Channel     string `json:"channel"`
	BuildNumber string `json:"build_number"`
	Branch      string `json:"branch"`
}

func (i Info) String() string {
	if i.BuildNumber != "" && i.Branch != "" {
		return fmt.Sprintf("%s-%s (build: %s, branch: %s)", i.Version, i.Channel, i.BuildNumber, i.Branch)
	}
	return fmt.Sprintf("%s-%s", i.Version, i.Channel)
}

var (
	Version     = ""
	Channel     = ""
	BuildNumber = ""
	Branch      = ""
)

func GetInfo() Info {
	return Info{
		Version:     Version,
		Channel:     Channel,
		BuildNumber: BuildNumber,
		Branch:      Branch,
	}
}
