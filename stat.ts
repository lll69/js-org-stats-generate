import { spawnSync } from "node:child_process";
import { Deque } from "@datastructures-js/deque";
import { parsePatch } from "diff";

type HistoryItem = {
    "time": number,
    "type": string,
    "server": string | string[],
    "comment": string | null,
    "commit": string | null,
    "pull": number | null,
};

class GitItem {
    time: number;
    id: string;
    childIds: string[];
    email: string;
    subject: string;

    constructor(time: number, id: string, childIds: string[], email: string, subject: string) {
        this.time = time
        this.id = id
        this.childIds = childIds
        this.email = email
        this.subject = subject
    }
}

function check_output(argv: string[]): string {
    const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf-8" });
    if (result.status != 0) {
        throw new Error(argv[0] + " failed with exit code" + result.status);
    }
    return result.stdout;
}

const updateTime = new Date();

const originExec = spawnSync("/usr/bin/git", ["-C", "js.org", "log", "--format=%at%n%H%n%P%n%ae%n%s%n"], { encoding: "utf-8" });
console.error(originExec.error);
if (originExec.status != 0) {
    throw new Error("git log failed with exit code" + originExec.status);
}
const originLines = originExec.stdout.split("\n");

const items: GitItem[] = [];
const itemMap: Record<string, GitItem> = {};
let i = 0, timestamp: number;
while (i < originLines.length) {
    timestamp = Number(originLines[i])
    i += 1
    let id = originLines[i];
    i += 1
    let childIdStr = originLines[i];
    let childIds: string[] = childIdStr == "" ? [] : childIdStr.split(" ");
    i += 1
    let email = originLines[i];
    i += 1
    let subject = originLines[i];
    i += 2
    let item = new GitItem(timestamp, id, childIds, email, subject);
    items.push(item);
    itemMap[id] = item
}

// Emails allowed to appear in the main Git commit path
const allowedEmails = [
    "bot@js.org",
    "stefan.keim@posteo.de",
    "indus@posteo.de",
    "indus@users.noreply.github.com",
    "me@mattcowley.co.uk",
    "matthew@cowley.org.uk",
];

// The following Git commits were directly merged into the js.org repo, and we must address this.
const allowedCommits = {
    "641c1343d02de8831a66a539c7917b79187f52d0": 8514,  // marionette.js.org (#8514) <paul@otterball.com>
    "db6e0d2d71c20f02dea10e70b4b68ee770e3f1d5": null,  // add blackbird.js.org subdomain mapping <arindamdutta132@gmail.com>
    "328b71bd15dbeb84707afd9019191d8889d3f18e": 12432,  // Update cnames_active.js with correct tag <arindamdutta132@gmail.com>
    "2409e868b9a45ede8b11065c21d03e462c458943": 12441,  // Update cnames_active.js <gmrafiweb@gmrafi.com>
};

const disallowedCommits = [
    // The following Git commits short-circuited the normal history.
    "6adfd9149629ca99f9a8e9771f8f587e96f1d83a",  // Remove concurrency from validate workflow
    "bebcb082418bfc5876889c2bd5de40a4c15065dc",  // Enable concurrency for validate workflow

    // The following Git commits created duplicate records.
    "a13e16d227b05b1344d9de9923fdeec98184eca9",  // cleanup and sort
    "533ea491945c5a7d2393e6ba5998b8b14688287a",  // cleanup and sort
];


function isAllowed(item: GitItem) {
    return (allowedEmails.indexOf(item.email) >= 0 || item.id in allowedCommits) && (disallowedCommits.indexOf(item.id) < 0);
}

function bfs(headId: string, firstId: string): string[] {
    const bfs = new Deque<string>();
    const vis = new Set<string>();
    const parent: Record<string, string> = {};
    bfs.pushBack(headId);
    if (!isAllowed(itemMap[headId]))
        throw new Error(`Unexpected Head ${headId}`);
    let id: string;
    while (bfs.size() > 0) {
        id = bfs.popFront();
        if (!vis.has(id)) {
            const item = itemMap[id];
            if (isAllowed(item)) {
                vis.add(id)
                for (const childId of item.childIds) {
                    if (!vis.has(childId)) {
                        parent[childId] = id
                        bfs.pushBack(childId);
                        if (childId == firstId) {
                            bfs.clear()
                            break
                        }
                    }
                }
            }
        }
    }
    id = firstId
    if (!(id in parent))
        throw new Error(`Unexpected Tail ${headId}-${firstId}`);
    const result: string[] = [];
    while (true) {
        result.push(id);
        if (id == headId)
            return result
        if (!(id in parent))
            break
        id = parent[id]
    }
    throw new Error(`Unexpected id=${id} when finding ${headId}-${firstId}`);
}

const mergeItems: GitItem[] = [];
const commitRegex = /^Merge pull request #(\d+) from (.*)$/;
for (const item of items) {
    if (isAllowed(item)) {
        const match = item.subject.match(commitRegex);
        if (match)
            mergeItems.push(item);
    }
}
mergeItems.push(itemMap["86da41b2e348bac3e49056ab9e3296a57a322206"]);  // Initial commit

const fullItems = [mergeItems[mergeItems.length - 1]];
for (let i = len(mergeItems) - 2; i >= 0; i--) {
    const bfsResult = bfs(mergeItems[i].id, mergeItems[i + 1].id);
    for (let j = 1; j < bfsResult.length; j++)
        fullItems.push(itemMap[bfsResult[j]]);
}

const cnameRegex = /^,?\s*("[a-z0-9_\-\.\\]+")\s*\:\s*("[A-Za-z0-9_/\-\.\\]+")\s*,?\s*(?:\/\/\s*(.+))?$/;
const nsRegex = /^,?\s*("[a-z0-9_\-\.\\]+")\s*\:\s*(\[.+\])\s*,?\s*(\/\/.+)?$/;
const cnameDict: Record<string, any> = {};


function addCnameItem(name: string, itemType: string, server: string | string[] | null, comment: string | null, item: GitItem) {
    let dictItem, historyItems: HistoryItem[];
    if (!(name in cnameDict)) {
        dictItem = {}
        dictItem["name"] = name
        dictItem["history"] = []
        cnameDict[name] = dictItem
    } else {
        dictItem = cnameDict[name]
    }
    historyItems = dictItem["history"]

    for (const historyItem of historyItems) {
        if (historyItem["commit"] == item.id) {
            if (!Array.isArray(historyItem["server"]) && Array.isArray(server)) {
                // cname -> ns
                historyItem["server"] = server
                historyItem["type"] = itemType
                return
            } else if (Array.isArray(historyItem["server"]) && typeof (server) == "string") {
                // ns -> cname (possible?)
                historyItem["server"] = server
                historyItem["type"] = itemType
                return
            } else if (typeof (server) == "string") {
                // mina.js.org has duplicated records
                if (!Array.isArray(historyItem["server"]))
                    historyItem["server"] = [historyItem["server"]]
                historyItem["server"].push(server)
                historyItem["type"] = itemType
                return
            } else
                throw new Error("Unknown duplicated records in commit " + item.id);
        }
    }
    let historyItem: Partial<HistoryItem> = {};
    dictItem["history"].append(historyItem)
    historyItem["time"] = item.time
    historyItem["type"] = itemType
    historyItem["server"] = server!;
    historyItem["comment"] = comment
    historyItem["commit"] = item.id
    const pushMatch = item.subject.match(commitRegex);
    if (pushMatch == null)
        if (item.id in allowedCommits)
            historyItem["pull"] = allowedCommits[item.id]
        else
            historyItem["pull"] = null;
    else
        historyItem["pull"] = Number(pushMatch[1])
}

function parseFullItems() {
    for (let i = 1; i < fullItems.length; i++) {
        const gitItem = fullItems[i];
        const originDiff = check_output([
            "/usr/bin/git",
            "-C",
            "js.org",
            "diff",
            fullItems[i - 1].id,
            gitItem.id,
            "--",
            "cnames_active.js",
            "ns_active.js"
        ]);
        const parsedDiff = parsePatch(originDiff);
        for (const file of parsedDiff) {
            const addItems: Array<any[]> = [];
            const removeItems: Array<any[]> = [];
            const addItemsRemoved: Array<any[]> = [];  // avoid duplicated records
            const removeItemsRemoved: Array<any[]> = [];
            for (const patch of file.hunks) {
                for (const line of patch.lines) {
                    const isAdded = line.startsWith("+"), isRemoved = line.startsWith("-");
                    if (isAdded || isRemoved) {
                        const lineStr = line.substring(1).trim();
                        if (file.newFileName == "b/cnames_active.js") {
                            const match = lineStr.match(cnameRegex);
                            if (match == null)
                                continue
                            const name: string = JSON.parse(match[1]);
                            const server: string = JSON.parse(match[2]);
                            const comment = match[3] || null;
                            if (isAdded)
                                addItems.push([name, server, comment, "cname"]);
                            else
                                removeItems.push([name, server, comment, "remove"]);
                        } else if (file.newFileName == "b/ns_active.js") {
                            const match = lineStr.match(nsRegex);
                            if (match == null)
                                continue
                            const name: string = JSON.parse(match[1]);
                            const servers: string[] = JSON.parse(match[2]);
                            const comment = match[3] || null;
                            if (isAdded)
                                addItems.push([name, servers, comment, "ns"]);
                            else
                                removeItems.push([name, servers, comment, "remove"]);
                        }
                    }
                }
            }
            for (const item of removeItems) {
                for (const addItem of addItems) {
                    if (addItem[0] == item[0]) {
                        if (addItem[1] == item[1] && addItem[2] == item[2]) {
                            // indention and sorting
                            addItemsRemoved.push(addItem)
                        }
                        // else: modify cname/comment
                        removeItemsRemoved.push(item)
                        break
                    }
                }
            }
            for (const item of addItems)
                if (addItemsRemoved.indexOf(item) < 0)
                    addCnameItem(item[0], item[3], item[1], item[2], gitItem)
            for (const item of removeItems)
                if (removeItemsRemoved.indexOf(item) < 0)
                    addCnameItem(item[0], item[3], null, null, gitItem)
        }
    }
}

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
    resolveDomains = [
        "github.io",
        "pages.dev",
        "gitlab.io",
        "gitbook.io",
        "gitbooks.io",
        "alwaysdata.net",
        "surge.sh",
        "onrender.com",
        "azurestaticapps.net",
    ]
    for item in cnameDict.values():
        historyItem = item["history"][-1]
        server = historyItem["server"]
        if type(server) != str:
            continue
        cname = server.split("/")[0]
        if cname.endswith(".vercel.app") or cname.endswith(".vercel-dns.com") or cname.endswith(".zeit.co") or cname.endswith(".now.sh"):
            mappedCname = "vercel"
        elif cname.endswith(".netlify.app") or cname.endswith(".netlify.com"):
            mappedCname = "netlify"
        else:
            for domain in resolveDomains:
                if cname.endswith("." + domain):
                    mappedCname = domain
                    break
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
        if not ("a" <= firstStr[0] <= "z"):
            firstStr = "z"
        if firstStr in filteredDict:
            filteredItem = filteredDict[firstStr]
        else:
            filteredItem = {}
            filteredDict[firstStr] = filteredItem
        filteredItem[item["name"]] = item
    return sortDict(filteredDict)


def isRemoveHistory(item):
    return item["type"] == "remove"


def generatePrTimeArray():
    timeArray = []
    baseDir = "dist/pulls/"
    for name in os.listdir(baseDir):
        if not name.endswith(".json"):
            continue
        with open(baseDir + name, "r", encoding="utf-8") as file:
            data = json.load(file)
        for prData in data.values():
            timeArray.append(int(datetime.datetime.fromisoformat(prData["create"]).timestamp()))
    timeArray = list(sorted(timeArray))
    return timeArray


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
    resultDict["prData"] = generatePrTimeArray()
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

# shutil.rmtree("dist", ignore_errors=True)
os.makedirs("dist", exist_ok=True)

with open("dist/cname.json", "w", encoding="utf-8") as file:
    cnameDictWithTime: dict = {"^updateTime": int(updateTime.timestamp())}
    cnameDictWithTime.update(cnameDict)
    file.write(json.dumps(cnameDictWithTime, separators=(",", ":"), indent=1))
    del cnameDictWithTime

with open("dist/commit.json", "w", encoding="utf-8") as file:
    commitItemsWithTime: dict = {"^updateTime": int(updateTime.timestamp())}
    commitItemsWithTime.update(commitItems)
    file.write(json.dumps(commitItemsWithTime, separators=(",", ":"), indent=1))
    del commitItemsWithTime

with open("dist/stat.json", "w", encoding="utf-8") as file:
    cnameStatWithTime = {"^updateTime": int(updateTime.timestamp())}
    cnameStatWithTime.update(cnameStat)
    file.write(json.dumps(cnameStatWithTime, separators=(",", ":"), indent=1))
    del cnameStatWithTime

with open("dist/statSimple.json", "w", encoding="utf-8") as file:
    cnameStatSimple = {"^updateTime": int(updateTime.timestamp())}
    for item in cnameStat.keys():
        cnameStatSimple[item] = len(cnameStat[item])
    file.write(json.dumps(cnameStatSimple, separators=(",", ":"), ensure_ascii=False))

for [firstStr, item] in filteredDict.items():
    with open(f"dist/{firstStr}.json", "w", encoding="utf-8") as file:
        item["^updateTime"] = int(updateTime.timestamp())
        file.write(json.dumps(item, separators=(",", ":"), ensure_ascii=False))

with open("dist/times.json", "w", encoding="utf-8") as file:
    file.write(json.dumps(timeDict, separators=(",", ":"), ensure_ascii=False))

for [year, timedItem] in timedDict.items():
    with open(f"dist/year{year}.json", "w", encoding="utf-8") as file:
        file.write(json.dumps(timedItem, separators=(",", ":"), ensure_ascii=False))

with open("dist/live.json", "w", encoding="utf-8") as file:
    file.write(json.dumps(timeDomains, separators=(",", ":"), ensure_ascii=False))

# stats
with open("dist/README.md", "w", encoding="utf-8") as file:
    file.write("# JS.ORG Stats\n")
    file.write(f"- **Updated time:** {updateTime.isoformat()}\n")
    file.write(f"- **Total subdomains:** {len(cnameDict)}\n")
    file.write(f"- **Live subdomains:** {len(timeDomains) - 1}\n")  # remove `^updateTime`
