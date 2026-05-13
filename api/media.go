package handler

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const particleCount = 100

func Handler(w http.ResponseWriter, r *http.Request) {
	media, unique, err := albumMedia("albums", particleCount)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"media":  media,
		"unique": unique,
		"total":  len(media),
	})
}

func albumMedia(dir string, total int) ([]string, int, error) {
	files, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, 0, nil
		}
		return nil, 0, err
	}

	var found []string
	for _, file := range files {
		if file.IsDir() {
			continue
		}
		name := file.Name()
		if !isMediaFile(name) {
			continue
		}
		found = append(found, "/albums/"+url.PathEscape(name))
	}
	sort.Strings(found)

	if len(found) == 0 || total <= 0 {
		return found, len(found), nil
	}

	out := make([]string, 0, total)
	for len(out) < total {
		for _, item := range found {
			out = append(out, item)
			if len(out) == total {
				break
			}
		}
	}
	return out, len(found), nil
}

func isMediaFile(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".mp4", ".webm", ".mov":
		return true
	default:
		return false
	}
}
