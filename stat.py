#!/usr/bin/python3
from collections import deque
import datetime
import json
import os
import re
import shutil
import subprocess
from unidiff import PatchSet


class GitItem:
    def __init__(self, time: int, id: str, childIds: list[str], email: str, subject: str):
        self.time = time
        self.id = id
        self.childIds = childIds
        self.email = email
        self.subject = subject


updateTime = datetime.datetime.now().astimezone(datetime.timezone.utc)

originLine = subprocess.check_output(["/usr/bin/git", "-C", "js.org", "log", '--format=%at%n%H%n%P%n%ae%n%s%n'],
                                     text=True, encoding="utf-8", errors="replace")
originLines = originLine.splitlines()

items: list[GitItem] = []
itemMap: dict[str, GitItem] = {}
i = 0
while i < len(originLines):
    timestamp = int(originLines[i])
    i += 1
    id = originLines[i]
    i += 1
    childIdStr = originLines[i]
    childIds = [] if childIdStr == "" else originLines[i].split(" ")
    i += 1
    email = originLines[i]
    i += 1
    subject = originLines[i]
    i += 2
    item = GitItem(timestamp, id, childIds, email, subject)
    items.append(item)
    itemMap[id] = item

# Emails allowed to appear in the main Git commit path
allowedEmails = {
    "bot@js.org",
    "stefan.keim@posteo.de",
    "indus@posteo.de",
    "indus@users.noreply.github.com",
    "me@mattcowley.co.uk",
    "matthew@cowley.org.uk",
}

# The following Git commits were incorrectly merged into the js.org repo, and we must address this.
allowedCommits = {
    "641c1343d02de8831a66a539c7917b79187f52d0",  # marionette.js.org (#8514)
}

disallowedCommits = {
    # The following Git commits short-circuited the normal history.
    "6adfd9149629ca99f9a8e9771f8f587e96f1d83a",  # Remove concurrency from validate workflow
    "bebcb082418bfc5876889c2bd5de40a4c15065dc",  # Enable concurrency for validate workflow

    # The following Git commits created duplicate records.
    "a13e16d227b05b1344d9de9923fdeec98184eca9",  # cleanup and sort
    "533ea491945c5a7d2393e6ba5998b8b14688287a",  # cleanup and sort
}


def isAllowed(item: GitItem):
    return (item.email in allowedEmails or item.id in allowedCommits) and item.id not in disallowedCommits


def bfs(headId: str, firstId: str):
    bfs: deque[str] = deque()
    vis: set[str] = set()
    parent: dict[str, str] = {}
    bfs.append(headId)
    if not isAllowed(itemMap[headId]):
        raise RuntimeError(f"Unexpected Head {headId}")
    while len(bfs) > 0:
        id = bfs.popleft()
        if id not in vis:
            item = itemMap[id]
            if isAllowed(item):
                vis.add(id)
                for childId in item.childIds:
                    if childId not in vis:
                        parent[childId] = id
                        bfs.append(childId)
                        if childId == firstId:
                            bfs.clear()
                            break
    id = firstId
    if id not in parent:
        raise RuntimeError(f"Unexpected Tail {headId}-{firstId}")
    result: list[str] = []
    while True:
        result.append(id)
        if id == headId:
            return result
        if id not in parent:
            break
        id = parent[id]
    raise RuntimeError(f"Unexpected id={id} when finding {headId}-{firstId}")


mergeItems: list[GitItem] = []
commitRegex = re.compile(r"Merge pull request #(\d+) from (.*)")
for item in items:
    if isAllowed(item):
        match = re.match(commitRegex, item.subject)
        if match is not None:
            mergeItems.append(item)
mergeItems.append(itemMap["86da41b2e348bac3e49056ab9e3296a57a322206"])  # Initial commit

fullItems: list[GitItem] = [mergeItems[-1]]
for i in range(len(mergeItems) - 2, -1, -1):
    bfsResult = bfs(mergeItems[i].id, mergeItems[i + 1].id)
    for j in range(1, len(bfsResult)):
        fullItems.append(itemMap[bfsResult[j]])

cnameRegex = re.compile(r',?\s*("[a-z0-9_\-\.\\]+")\s*\:\s*("[A-Za-z0-9_/\-\.\\]+")\s*,?\s*(?://\s*(.+))?')
nsRegex = re.compile(r',?\s*("[a-z0-9_\-\.\\]+")\s*\:\s*(\[.+\])\s*,?\s*(//.+)?')
cnameDict: dict[str, dict] = {}


def addCnameItem(name: str, itemType: str, server, comment, item: GitItem):
    if name not in cnameDict:
        dictItem = {}
        dictItem["name"] = name
        dictItem["history"] = []
        cnameDict[name] = dictItem
    else:
        dictItem = cnameDict[name]
    historyItems = dictItem["history"]

    for historyItem in historyItems:
        if historyItem["commit"] == item.id:
            if type(historyItem["server"]) != list and type(server) == list:
                # cname -> ns
                historyItem["server"] = server
                historyItem["type"] = itemType
                return
            elif type(historyItem["server"]) == list and type(server) == str:
                # ns -> cname (possible?)
                historyItem["server"] = server
                historyItem["type"] = itemType
                return
            elif type(server) == str:
                # mina.js.org has duplicated records
                if type(historyItem["server"]) != list:
                    historyItem["server"] = [historyItem["server"]]
                historyItem["server"].append(server)
                historyItem["type"] = itemType
                return
            else:
                raise RuntimeError("Unknown duplicated records in commit", item.id)

    historyItem = {}
    dictItem["history"].append(historyItem)
    historyItem["time"] = item.time
    historyItem["type"] = itemType
    historyItem["server"] = server
    historyItem["comment"] = comment
    historyItem["commit"] = item.id
    pushMatch = re.match(commitRegex, item.subject)
    if pushMatch is None:
        historyItem["pull"] = None
    else:
        historyItem["pull"] = int(pushMatch.group(1))


def parseFullItems():
    for i in range(1, len(fullItems)):
        gitItem = fullItems[i]
        originDiff = subprocess.check_output([
            "/usr/bin/git",
            "-C",
            "js.org",
            "diff",
            fullItems[i - 1].id,
            gitItem.id,
            "--",
            "cnames_active.js",
            "ns_active.js"
        ], text=True, encoding="utf-8", errors="replace")
        parsedDiff = PatchSet.from_string(originDiff)
        for file in parsedDiff:
            addItems = []
            removeItems = []
            addItemsRemoved = []  # avoid duplicated records
            removeItemsRemoved = []
            for patch in file:
                for line in patch:
                    if line.is_added or line.is_removed:
                        lineStr = line.value.strip()
                        if "mina\"" in lineStr:
                            breakpoint = 0
                        if file.target_file == "b/cnames_active.js":
                            match = re.match(cnameRegex, lineStr)
                            if match is None:
                                continue
                            name: str = json.loads(match.group(1))
                            server: str = json.loads(match.group(2))
                            comment = match.group(3)
                            if line.is_added:
                                addItems.append([name, server, comment, "cname"])
                            else:
                                removeItems.append([name, server, comment, "remove"])
                        elif file.target_file == "b/ns_active.js":
                            match = re.match(nsRegex, lineStr)
                            if match is None:
                                continue
                            name: str = json.loads(match.group(1))
                            servers: list[str] = json.loads(match.group(2))
                            comment = match.group(3)
                            if line.is_added:
                                addItems.append([name, servers, comment, "ns"])
                            else:
                                removeItems.append([name, servers, comment, "remove"])
            for item in removeItems:
                for addItem in addItems:
                    if addItem[0] == item[0]:
                        if addItem[1] == item[1] and addItem[2] == item[2]:
                            # indention and sorting
                            addItemsRemoved.append(addItem)
                        # else: modify cname/comment
                        removeItemsRemoved.append(item)
                        break
            for item in addItems:
                if item not in addItemsRemoved:
                    addCnameItem(item[0], item[3], item[1], item[2], gitItem)
            for item in removeItems:
                if item not in removeItemsRemoved:
                    addCnameItem(item[0], item[3], None, None, gitItem)


def sortDict(inDict: dict):
    sortedList = list(inDict.items())
    sortedList.sort(key=lambda item: len(item[1]), reverse=True)
    outDict: dict = {}
    for item in sortedList:
        outDict[item[0]] = item[1]
    return outDict


def generateCommitItems():
    commitItems: dict[str, list[str]] = {}
    for item in cnameDict.values():
        for historyItem in item["history"]:
            id = historyItem["commit"]
            if id in commitItems:
                commitItem = commitItems[id]
            else:
                commitItem = []
                commitItems[id] = commitItem
            commitItem.append(item["name"])
    return sortDict(commitItems)


def generateCnameStat():
    cnameStat: dict[str, list[str]] = {}
    for item in cnameDict.values():
        historyItem = item["history"][-1]
        server = historyItem["server"]
        if type(server) != str:
            continue
        cname = server.split("/")[0]
        if cname.endswith(".github.io"):
            mappedCname = "github.io"
        elif cname.endswith(".pages.dev"):
            mappedCname = "pages.dev"
        elif cname.endswith(".gitlab.io"):
            mappedCname = "gitlab.io"
        elif cname.endswith(".gitbook.io"):
            mappedCname = "gitbook.io"
        elif cname.endswith(".vercel.app") or cname.endswith(".vercel-dns.com"):
            mappedCname = "vercel"
        elif cname.endswith(".netlify.app") or cname.endswith(".netlify.com"):
            mappedCname = "netlify"
        else:
            mappedCname = cname
        if mappedCname in cnameStat:
            statItem = cnameStat[mappedCname]
        else:
            statItem = []
            cnameStat[mappedCname] = statItem
        statItem.append(item["name"])
    return sortDict(cnameStat)


def generateFilteredDict():
    filteredDict: dict[str, dict] = {}
    for item in cnameDict.values():
        name: str = item["name"]
        if len(name) == 0:
            continue
        firstStr = name[0].lower()
        if not ('a' <= firstStr[0] <= 'z'):
            firstStr = 'z'
        if firstStr in filteredDict:
            filteredItem = filteredDict[firstStr]
        else:
            filteredItem = {}
            filteredDict[firstStr] = filteredItem
        filteredItem[item["name"]] = item
    return sortDict(filteredDict)


def isRemoveHistory(item):
    return item["type"] == "remove"


def generateTimeDicts():
    timeArray: list[int] = []
    timedDict: dict[int, dict] = {}
    for item in cnameDict.values():
        historyItems = item["history"]
        for i in range(len(historyItems)):
            historyItem = historyItems[i]
            year = datetime.datetime.fromtimestamp(historyItem["time"], datetime.UTC).year
            if year in timedDict:
                timedDictItem = timedDict[year]
            else:
                timedDictItem: dict = {"^updateTime": int(updateTime.timestamp())}
                timedDict[year] = timedDictItem
            if isRemoveHistory(historyItem) and (i == 0 or not isRemoveHistory(historyItems[i - 1])):
                time = -historyItem["time"]
                timeArray.append(time)
                if time in timedDictItem:
                    timedItem = timedDictItem[time]
                    if type(timedItem) == list:
                        timedItem.append(item["name"])
                    else:
                        timedDictItem[time] = [timedItem, item["name"]]
                else:
                    timedDictItem[time] = item["name"]
            elif (not isRemoveHistory(historyItem)) and (i == 0 or isRemoveHistory(historyItems[i - 1])):
                time = historyItem["time"]
                timeArray.append(time)
                if time in timedDictItem:
                    timedItem = timedDictItem[time]
                    if type(timedItem) == list:
                        timedItem.append(item["name"])
                    else:
                        timedDictItem[time] = [timedItem, item["name"]]
                else:
                    timedDictItem[time] = item["name"]
    timeArray.sort(key=abs)
    resultArray = []
    i = 0
    length = len(timeArray)
    while i < length:
        count = 1
        time = timeArray[i]
        while i + 1 < length and timeArray[i + 1] == time:
            i += 1
            count += 1
        if count == 1:
            resultArray.append(time)
        else:
            resultArray.append([time, count])
        i += 1
    resultDict: dict = {"^updateTime": int(updateTime.timestamp())}
    resultDict["data"] = resultArray
    for timedDictItem in timedDict.values():
        for timedItem in timedDictItem.values():
            if type(timedItem) == list:
                timedItem.sort()
    return (resultDict, timedDict)


def generateTimeDomains():
    timeDomains: dict[str, int] = {"^updateTime": int(updateTime.timestamp())}
    for item in cnameDict.values():
        if item["history"][-1]["type"] != "remove":
            timeDomains[item["name"]] = item["history"][0]["time"]
    return timeDomains


parseFullItems()
commitItems = generateCommitItems()
cnameStat = generateCnameStat()
filteredDict = generateFilteredDict()
timeDict, timedDict = generateTimeDicts()
timeDomains = generateTimeDomains()

shutil.rmtree("dist", ignore_errors=True)
os.makedirs("dist", exist_ok=True)

with open("dist/cname.json", "w", encoding="utf-8") as file:
    cnameDictWithTime: dict = {"^updateTime": int(updateTime.timestamp())}
    cnameDictWithTime.update(cnameDict)
    file.write(json.dumps(cnameDictWithTime, separators=(',', ':'), indent=1))
    del cnameDictWithTime

with open("dist/commit.json", "w", encoding="utf-8") as file:
    commitItemsWithTime: dict = {"^updateTime": int(updateTime.timestamp())}
    commitItemsWithTime.update(commitItems)
    file.write(json.dumps(commitItemsWithTime, separators=(',', ':'), indent=1))
    del commitItemsWithTime

with open("dist/stat.json", "w", encoding="utf-8") as file:
    cnameStatWithTime = {"^updateTime": int(updateTime.timestamp())}
    cnameStatWithTime.update(cnameStat)
    file.write(json.dumps(cnameStatWithTime, separators=(',', ':'), indent=1))
    del cnameStatWithTime

with open("dist/statSimple.json", "w", encoding="utf-8") as file:
    cnameStatSimple = {"^updateTime": int(updateTime.timestamp())}
    for item in cnameStat.keys():
        cnameStatSimple[item] = len(cnameStat[item])
    file.write(json.dumps(cnameStatSimple, separators=(',', ':'), ensure_ascii=False))

for [firstStr, item] in filteredDict.items():
    with open(f"dist/{firstStr}.json", "w", encoding="utf-8") as file:
        item["^updateTime"] = int(updateTime.timestamp())
        file.write(json.dumps(item, separators=(',', ':'), ensure_ascii=False))

with open("dist/times.json", "w", encoding="utf-8") as file:
    file.write(json.dumps(timeDict, separators=(',', ':'), ensure_ascii=False))

for [year, timedItem] in timedDict.items():
    with open(f"dist/year{year}.json", "w", encoding="utf-8") as file:
        file.write(json.dumps(timedItem, separators=(',', ':'), ensure_ascii=False))

with open("dist/live.json", "w", encoding="utf-8") as file:
    file.write(json.dumps(timeDomains, separators=(',', ':'), ensure_ascii=False))

# stats
with open("dist/README.md", "w", encoding="utf-8") as file:
    file.write("# JS.ORG Stats\n")
    file.write(f"- **Updated time:** {updateTime.isoformat()}\n")
    file.write(f"- **Total subdomains:** {len(cnameDict)}\n")
    file.write(f"- **Live subdomains:** {len(timeDomains) - 1}\n")  # remove `^updateTime`
