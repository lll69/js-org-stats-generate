#!/usr/bin/python3
import json
import os
import requests
import sys
import time

if len(sys.argv) != 2:
    GITHUB_TOKEN = input("Enter GitHub Token: ").strip()
    if len(GITHUB_TOKEN) == 0:
        print("GITHUB_TOKEN is required", file=sys.stderr)
        exit(1)
else:
    GITHUB_TOKEN = sys.argv[1]
OUT_DIR = "dist/pulls"
MAX_TRIES = 16

os.makedirs(OUT_DIR, exist_ok=True)

session = requests.Session()
session.headers.update(
    {
        "Authorization": "Bearer " + GITHUB_TOKEN,
    }
)

pullsData = {}

currentPage = 1
tries = 0
totalParsedPulls = 0
while True:
    if tries >= MAX_TRIES:
        print(f"Tried for {tries} times, exiting")
        exit(1)
    url = f"https://api.github.com/repos/js-org/js.org/pulls?state=all&per_page=100&page={currentPage}"
    resp = session.get(url)
    if resp.status_code != 200 and resp.status_code != 304:
        currentTime = time.time()
        resetTime = float(resp.headers.get("x-ratelimit-reset", currentTime + 10)) - currentTime
        print(f"status={resp.status_code}, sleep {resetTime} seconds")
        time.sleep(resetTime)
        tries += 1
        continue
    tries = 0
    pulls = resp.json()
    parsedPulls = 0
    if len(pulls) == 0:
        break
    minPullNum = 2147483647
    maxPullNum = 0
    for pull in pulls:
        pullNum = int(pull["number"])
        pullCreateTime = pull["created_at"]
        pullCloseTime = pull["closed_at"]
        pullMergeTime = pull["merged_at"]
        pullMergeSha = pull["merge_commit_sha"]
        pullUserId = int(pull["user"]["id"])

        if pullNum == 0:
            print("Invalid pull: " + str(pull))
            continue

        minPullNum = min(pullNum, minPullNum)
        maxPullNum = max(pullNum, maxPullNum)

        pullDir = pullNum // 100
        if pullDir not in pullsData:
            pullsData[pullDir] = {}
        pullsData[pullDir][pullNum] = {
            "create": pullCreateTime,
            "close": pullCloseTime,
            "merge": pullMergeTime,
            "sha": pullMergeSha,
            "userId": pullUserId,
        }
        parsedPulls += 1
    totalParsedPulls += parsedPulls
    print(f"Parsed {parsedPulls} pulls in page {currentPage} with PR Range {minPullNum}-{maxPullNum}")
    time.sleep(1)
    currentPage += 1

for pullDir in pullsData:
    pullsSubData = pullsData[pullDir]
    with open(f"{OUT_DIR}/{pullDir}.json", "w", encoding="utf-8") as f:
        json.dump(pullsSubData, f, separators=(",", ":"))
