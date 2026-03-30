package utils

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/base32"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/anacrolix/torrent/metainfo"
	"github.com/sirrobot01/decypharr/internal/logger"
	"github.com/sirrobot01/decypharr/internal/request"
)

var (
	hexRegex = regexp.MustCompile("^[0-9a-fA-F]{40}$")
)

type Magnet struct {
	Name     string `json:"name"`
	InfoHash string `json:"infoHash"`
	Size     int64  `json:"size"`
	Link     string `json:"link"`
	File     []byte `json:"-"`
}

func (m *Magnet) IsTorrent() bool {
	return m.File != nil
}

// stripTrackersFromMagnet removes trackers from a magnet and returns a modified copy
func stripTrackersFromMagnet(mi metainfo.Magnet, fileType string) metainfo.Magnet {
	originalTrackerCount := len(mi.Trackers)
	if len(mi.Trackers) > 0 {
		log := logger.Default()
		mi.Trackers = nil
		log.Printf("Removed %d tracker URLs from %s", originalTrackerCount, fileType)
	}
	return mi
}

func GetMagnetFromFile(file io.Reader, filePath string, rmTrackerUrls bool) (*Magnet, error) {
	var (
		m   *Magnet
		err error
	)
	if filepath.Ext(filePath) == ".torrent" {
		torrentData, err := io.ReadAll(file)
		if err != nil {
			return nil, err
		}
		m, err = GetMagnetFromBytes(torrentData, rmTrackerUrls)
		if err != nil {
			return nil, err
		}
	} else {
		// .magnet file
		magnetLink := ReadMagnetFile(file)
		m, err = GetMagnetInfo(magnetLink, rmTrackerUrls)
		if err != nil {
			return nil, err
		}
	}
	m.Name = strings.TrimSuffix(filePath, filepath.Ext(filePath))
	return m, nil
}

func GetMagnetFromUrl(url string, rmTrackerUrls bool) (*Magnet, error) {
	if strings.HasPrefix(url, "magnet:") {
		return GetMagnetInfo(url, rmTrackerUrls)
	} else if strings.HasPrefix(url, "http") {
		return OpenMagnetHttpURL(url, rmTrackerUrls)
	}
	return nil, fmt.Errorf("invalid url")
}

func GetMagnetFromBytes(torrentData []byte, rmTrackerUrls bool) (*Magnet, error) {
	// Create a scanner to read the file line by line
	mi, err := metainfo.Load(bytes.NewReader(torrentData))
	if err != nil {
		return nil, err
	}

	hash := mi.HashInfoBytes()
	infoHash := hash.HexString()
	info, err := mi.UnmarshalInfo()
	if err != nil {
		return nil, err
	}
	magnetMeta := mi.Magnet(&hash, &info)
	if rmTrackerUrls {
		magnetMeta = stripTrackersFromMagnet(magnetMeta, "torrent file")
	}
	magnet := &Magnet{
		InfoHash: infoHash,
		Name:     info.Name,
		Size:     info.Length,
		Link:     magnetMeta.String(),
		File:     torrentData,
	}
	return magnet, nil
}

func ReadMagnetFile(file io.Reader) string {
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		content := scanner.Text()
		if content != "" {
			return content
		}
	}

	// Check for any errors during scanning
	if err := scanner.Err(); err != nil {
		log := logger.Default()
		log.Println("Error reading file:", err)
	}
	return ""
}

func OpenMagnetHttpURL(magnetLink string, rmTrackerUrls bool) (*Magnet, error) {
	resp, err := http.Get(magnetLink)
	if err != nil {
		return nil, fmt.Errorf("error making GET request: %v", err)
	}
	defer func(resp *http.Response) {
		err := resp.Body.Close()
		if err != nil {
			return
		}
	}(resp) // Ensure the response is closed after the function ends
	torrentData, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("error reading response body: %v", err)
	}
	return GetMagnetFromBytes(torrentData, rmTrackerUrls)
}

func GetMagnetInfo(magnetLink string, rmTrackerUrls bool) (*Magnet, error) {
	if magnetLink == "" {
		return nil, fmt.Errorf("error getting magnet from file")
	}

	mi, err := metainfo.ParseMagnetUri(magnetLink)
	if err != nil {
		return nil, fmt.Errorf("error parsing magnet link: %w", err)
	}

	// Strip all announce URLs if requested
	if rmTrackerUrls {
		mi = stripTrackersFromMagnet(mi, "magnet link")
	}

	btih := mi.InfoHash.HexString()
	dn := mi.DisplayName

	// Reconstruct the magnet link using the (possibly modified) spec
	finalLink := mi.String()

	magnet := &Magnet{
		InfoHash: btih,
		Name:     dn,
		Size:     0,
		Link:     finalLink,
	}
	return magnet, nil
}

func ExtractInfoHash(magnetDesc string) string {
	const prefix = "xt=urn:btih:"
	start := strings.Index(magnetDesc, prefix)
	if start == -1 {
		return ""
	}
	hash := ""
	start += len(prefix)
	end := strings.IndexAny(magnetDesc[start:], "&#")
	if end == -1 {
		hash = magnetDesc[start:]
	} else {
		hash = magnetDesc[start : start+end]
	}
	hash, _ = processInfoHash(hash) // Convert to hex if needed
	return hash
}

func processInfoHash(input string) (string, error) {
	// Regular expression for a valid 40-character hex infohash

	// If it's already a valid hex infohash, return it as is
	if hexRegex.MatchString(input) {
		return strings.ToLower(input), nil
	}

	// If it's 32 characters long, it might be Base32 encoded
	if len(input) == 32 {
		// Ensure the input is uppercase and remove any padding
		input = strings.ToUpper(strings.TrimRight(input, "="))

		// Try to decode from Base32
		decoded, err := base32.StdEncoding.DecodeString(input)
		if err == nil && len(decoded) == 20 {
			// If successful and the result is 20 bytes, encode to hex
			return hex.EncodeToString(decoded), nil
		}
	}

	// If we get here, it's not a valid infohash and we couldn't convert it
	return "", fmt.Errorf("invalid infohash: %s", input)
}

func GetInfohashFromURL(url string) (string, error) {
	// Download the torrent file
	var magnetLink string
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	redirectFunc := func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return fmt.Errorf("stopped after 3 redirects")
		}
		if strings.HasPrefix(req.URL.String(), "magnet:") {
			// Stop the redirect chain
			magnetLink = req.URL.String()
			return http.ErrUseLastResponse
		}
		return nil
	}
	client := request.New(
		request.WithTimeout(30*time.Second),
		request.WithRedirectPolicy(redirectFunc),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if magnetLink != "" {
		return ExtractInfoHash(magnetLink), nil
	}

	mi, err := metainfo.Load(resp.Body)
	if err != nil {
		return "", err
	}
	hash := mi.HashInfoBytes()
	infoHash := hash.HexString()
	return infoHash, nil
}

func ConstructMagnet(infoHash, name string) *Magnet {
	// Create a magnet link from the infohash and name
	name = url.QueryEscape(strings.TrimSpace(name))
	magnetUri := fmt.Sprintf("magnet:?xt=urn:btih:%s&dn=%s", infoHash, name)
	return &Magnet{
		InfoHash: infoHash,
		Name:     name,
		Size:     0,
		Link:     magnetUri,
	}
}

func CreateTorrentFileFromPath(rootPath, torrentName, magnetUri string) ([]byte, error) {
	rootPath = filepath.Clean(rootPath)
	if rootPath == "" {
		return nil, fmt.Errorf("torrent path is empty")
	}
	info, err := os.Stat(rootPath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat torrent path: %w", err)
	}

	entries, totalSize, err := collectTorrentFiles(rootPath, info)
	if err != nil {
		return nil, err
	}

	if len(entries) == 0 {
		return nil, fmt.Errorf("no files found for torrent path %s", rootPath)
	}

	pieceLength := chooseTorrentPieceLength(totalSize)
	pieces, err := computeTorrentPieces(entries, pieceLength)
	if err != nil {
		return nil, err
	}

	name := strings.TrimSpace(torrentName)
	if name == "" {
		name = filepath.Base(rootPath)
	}
	if name == "" {
		name = "torrent"
	}

	infoDict := map[string]any{
		"name":         name,
		"piece length": int64(pieceLength),
		"pieces":       pieces,
	}

	if len(entries) == 1 && !info.IsDir() {
		infoDict["length"] = entries[0].Length
	} else {
		filesList := make([]any, 0, len(entries))
		for _, entry := range entries {
			filesList = append(filesList, map[string]any{
				"length": entry.Length,
				"path":   pathListToBencode(entry.RelPath),
			})
		}
		infoDict["files"] = filesList
	}

	torrentDict := map[string]any{
		"info":         infoDict,
		"creation date": time.Now().Unix(),
		"created by":   "Decypharr",
	}

	trackers := extractTrackersFromMagnet(magnetUri)
	if len(trackers) > 0 {
		torrentDict["announce"] = trackers[0]
		announceList := make([]any, 0, len(trackers))
		for _, tracker := range trackers {
			announceList = append(announceList, []any{tracker})
		}
		torrentDict["announce-list"] = announceList
	}

	return bencodeValue(torrentDict)
}

type torrentFileEntry struct {
	Path    string
	RelPath []string
	Length  int64
}

func collectTorrentFiles(rootPath string, info os.FileInfo) ([]torrentFileEntry, int64, error) {
	if !info.IsDir() {
		return []torrentFileEntry{{
			Path:    rootPath,
			RelPath: []string{filepath.Base(rootPath)},
			Length:  info.Size(),
		}}, info.Size(), nil
	}

	entries := make([]torrentFileEntry, 0)
	var totalSize int64
	walkErr := filepath.WalkDir(rootPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		fileInfo, err := d.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(rootPath, path)
		if err != nil {
			return err
		}
		entries = append(entries, torrentFileEntry{
			Path:    path,
			RelPath: strings.Split(filepath.ToSlash(rel), "/"),
			Length:  fileInfo.Size(),
		})
		totalSize += fileInfo.Size()
		return nil
	})
	if walkErr != nil {
		return nil, 0, walkErr
	}

	sort.Slice(entries, func(i, j int) bool {
		return strings.Join(entries[i].RelPath, "/") < strings.Join(entries[j].RelPath, "/")
	})

	return entries, totalSize, nil
}

func chooseTorrentPieceLength(totalSize int64) int {
	switch {
	case totalSize <= 64<<20:
		return 256 << 10
	case totalSize <= 256<<20:
		return 512 << 10
	case totalSize <= 1024<<20:
		return 1 << 20
	case totalSize <= 4096<<20:
		return 2 << 20
	default:
		return 4 << 20
	}
}

func computeTorrentPieces(entries []torrentFileEntry, pieceLength int) ([]byte, error) {
	h := sha1.New()
	pieces := bytes.NewBuffer(nil)
	buffer := make([]byte, 32*1024)
	currentPieceSize := 0

	appendPiece := func() error {
		pieces.Write(h.Sum(nil))
		h.Reset()
		currentPieceSize = 0
		return nil
	}

	for _, entry := range entries {
		file, err := os.Open(entry.Path)
		if err != nil {
			return nil, err
		}
		defer file.Close()

		for {
			n, err := file.Read(buffer)
			if n > 0 {
				offset := 0
				for offset < n {
					chunk := n - offset
					remaining := pieceLength - currentPieceSize
					if chunk > remaining {
						chunk = remaining
					}
					h.Write(buffer[offset : offset+chunk])
					currentPieceSize += chunk
					offset += chunk
					if currentPieceSize == pieceLength {
						if err := appendPiece(); err != nil {
							return nil, err
						}
					}
				}
			}
			if err != nil {
				if err == io.EOF {
					break
				}
				return nil, err
			}
		}
	}

	if currentPieceSize > 0 {
		if err := appendPiece(); err != nil {
			return nil, err
		}
	}

	return pieces.Bytes(), nil
}

func pathListToBencode(components []string) []any {
	result := make([]any, len(components))
	for i, component := range components {
		result[i] = component
	}
	return result
}

func extractTrackersFromMagnet(magnetUri string) []string {
	if magnetUri == "" {
		return nil
	}
	parsed, err := url.Parse(magnetUri)
	if err != nil {
		return nil
	}
	return parsed.Query()["tr"]
}

func bencodeValue(value any) ([]byte, error) {
	var buf bytes.Buffer
	if err := bencodeAny(&buf, value); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func bencodeAny(w io.Writer, value any) error {
	switch v := value.(type) {
	case string:
		return bencodeString(w, v)
	case []byte:
		return bencodeBytes(w, v)
	case int:
		return bencodeInt(w, int64(v))
	case int64:
		return bencodeInt(w, v)
	case map[string]any:
		return bencodeDict(w, v)
	case []any:
		return bencodeList(w, v)
	default:
		return fmt.Errorf("unsupported bencode type: %T", v)
	}
}

func bencodeString(w io.Writer, value string) error {
	_, err := fmt.Fprintf(w, "%d:%s", len(value), value)
	return err
}

func bencodeBytes(w io.Writer, value []byte) error {
	_, err := fmt.Fprintf(w, "%d:", len(value))
	if err != nil {
		return err
	}
	_, err = w.Write(value)
	return err
}

func bencodeInt(w io.Writer, value int64) error {
	_, err := fmt.Fprintf(w, "i%de", value)
	return err
}

func bencodeList(w io.Writer, list []any) error {
	if _, err := w.Write([]byte("l")); err != nil {
		return err
	}
	for _, item := range list {
		if err := bencodeAny(w, item); err != nil {
			return err
		}
	}
	_, err := w.Write([]byte("e"))
	return err
}

func bencodeDict(w io.Writer, dict map[string]any) error {
	keys := make([]string, 0, len(dict))
	for key := range dict {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if _, err := w.Write([]byte("d")); err != nil {
		return err
	}
	for _, key := range keys {
		if err := bencodeString(w, key); err != nil {
			return err
		}
		if err := bencodeAny(w, dict[key]); err != nil {
			return err
		}
	}
	_, err := w.Write([]byte("e"))
	return err
}
