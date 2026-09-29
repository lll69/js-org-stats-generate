import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { Deque } from "@datastructures-js/deque";
import { parsePatch } from "diff";
import _ from "lodash";

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
    const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf-8", maxBuffer: 104857600 });
    if (result.status != 0) {
        throw new Error(argv[0] + " failed with exit code" + result.status);
    }
    return result.stdout;
}

function contains(arr: any[], item: any) {
    for (let i = 0; i < arr.length; i++) {
        if (_.isEqual(arr[i], item)) return true;
    }
    return false;
}

const updateTime = new Date();

const originExec = spawnSync("/usr/bin/git", ["-C", "js.org", "log", "--format=%at%n%H%n%P%n%ae%n%s%n"], { encoding: "utf-8", maxBuffer: 104857600 });
console.error(originExec.stderr);
if (originExec.status != 0) {
    throw new Error("git log failed with exit code" + originExec.status);
}
let originLines = originExec.stdout.split("\n");
originLines = originLines.slice(0, Math.floor(originLines.length / 6) * 6);

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
    return (allowedEmails.indexOf(item.email) >= 0 || allowedCommits.hasOwnProperty(item.id)) && (disallowedCommits.indexOf(item.id) < 0);
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
    if (!(parent.hasOwnProperty(id)))
        throw new Error(`Unexpected Tail ${headId}-${firstId}`);
    const result: string[] = [];
    while (true) {
        result.push(id);
        if (id == headId)
            return result
        if (!parent.hasOwnProperty(id))
            break
        id = parent[id]
    }
    throw new Error(`Unexpected id=${id} when finding ${headId}-${firstId}`);
}

const mergeItems: GitItem[] = [];
const commitRegex = /^Merge pull request #(\d+) from (.*)/;
for (const item of items) {
    if (isAllowed(item)) {
        const match = item.subject.match(commitRegex);
        if (match)
            mergeItems.push(item);
    }
}
mergeItems.push(itemMap["86da41b2e348bac3e49056ab9e3296a57a322206"]);  // Initial commit

const fullItems = [mergeItems[mergeItems.length - 1]];
for (let i = mergeItems.length - 2; i >= 0; i--) {
    const bfsResult = bfs(mergeItems[i].id, mergeItems[i + 1].id);
    for (let j = 1; j < bfsResult.length; j++)
        fullItems.push(itemMap[bfsResult[j]]);
}

const cnameRegex = /^,?\s*("[a-z0-9_\-\.\\]+")\s*\:\s*("[A-Za-z0-9_/\-\.\\]+")\s*,?\s*(?:\/\/\s*(.+))?/;
const nsRegex = /^,?\s*("[a-z0-9_\-\.\\]+")\s*\:\s*(\[.+\])\s*,?\s*(\/\/.+)?/;
const cnameDict: Record<string, any> = {};


function addCnameItem(name: string, itemType: string, server: string | string[] | null, comment: string | null, item: GitItem) {
    let dictItem, historyItems: HistoryItem[];
    if (!cnameDict.hasOwnProperty(name)) {
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
    dictItem["history"].push(historyItem);
    historyItem["time"] = item.time
    historyItem["type"] = itemType
    historyItem["server"] = server!;
    historyItem["comment"] = comment
    historyItem["commit"] = item.id
    const pushMatch = item.subject.match(commitRegex);
    if (pushMatch == null)
        if (allowedCommits.hasOwnProperty(item.id))
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
                    if (_.isEqual(addItem[0], item[0])) {
                        if (_.isEqual(addItem[1], item[1]) && _.isEqual(addItem[2], item[2])) {
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
                if (!contains(addItemsRemoved, item))
                    addCnameItem(item[0], item[3], item[1], item[2], gitItem)
            for (const item of removeItems)
                if (!contains(removeItemsRemoved, item))
                    addCnameItem(item[0], item[3], null, null, gitItem)
        }
    }
}

function sortDict<T1 extends keyof any, T2 extends { length: number }>(inDict: Record<T1, T2>): Record<T1, T2> {
    const sortedList = Object.entries(inDict);
    sortedList.sort((a, b) => (b[1] as T2).length - (a[1] as T2).length);
    const outDict = {} as Record<T1, T2>;
    for (const item of sortedList)
        outDict[item[0]] = item[1]
    return outDict
}

function generateCommitItems() {
    const commitItems: Record<string, string[]> = {};
    for (const item of Object.values(cnameDict)) {
        for (const historyItem of item["history"]) {
            const id = historyItem["commit"];
            let commitItem: string[];
            if (commitItems.hasOwnProperty(id))
                commitItem = commitItems[id]
            else {
                commitItem = []
                commitItems[id] = commitItem
            }
            commitItem.push(item["name"]);
        }
    }
    return sortDict(commitItems);
}

function generateCnameStat() {
    const cnameStat: Record<string, string[]> = {};
    const resolveDomains = [
        "github.io",
        "pages.dev",
        "gitlab.io",
        "gitbook.io",
        "gitbooks.io",
        "alwaysdata.net",
        "surge.sh",
        "onrender.com",
        "azurestaticapps.net",
    ];
    for (const item of Object.values(cnameDict)) {
        const historyItem = item["history"][item["history"].length - 1];
        const server = historyItem["server"];
        if (typeof (server) != "string")
            continue
        const cname = server.split("/")[0];
        let mappedCname: string;
        if (cname.endsWith(".vercel.app") || cname.endsWith(".vercel-dns.com") || cname.endsWith(".zeit.co") || cname.endsWith(".now.sh"))
            mappedCname = "vercel"
        else if (cname.endsWith(".netlify.app") || cname.endsWith(".netlify.com"))
            mappedCname = "netlify"
        else {
            mappedCname = cname
            for (const domain of resolveDomains) {
                if (cname.endsWith("." + domain)) {
                    mappedCname = domain
                    break
                }
            }
        }
        let statItem: string[];
        if (cnameStat.hasOwnProperty(mappedCname))
            statItem = cnameStat[mappedCname]
        else {
            statItem = []
            cnameStat[mappedCname] = statItem
        }
        statItem.push(item["name"]);
    }
    return sortDict(cnameStat)
}

function generateFilteredDict() {
    const filteredDict: Record<string, any> = {};
    for (const item of Object.values(cnameDict)) {
        const name: string = item["name"];
        if (name.length == 0)
            continue
        let firstStr = name[0].toLowerCase(), filteredItem;
        if (!("a" <= firstStr[0] && firstStr[0] <= "z"))
            firstStr = "z"
        if (filteredDict.hasOwnProperty(firstStr)) {
            filteredItem = filteredDict[firstStr]
        } else {
            filteredItem = {}
            filteredDict[firstStr] = filteredItem
        }
        filteredItem[item["name"]] = item
    }
    return sortDict(filteredDict)
}

function isRemoveHistory(item) {
    return item["type"] == "remove"
}

function generatePrTimeArray() {
    const timeArray: number[] = [];
    const baseDir = "dist/pulls/";
    for (const name of readdirSync(baseDir)) {
        if (!name.endsWith(".json"))
            continue
        const data = JSON.parse(readFileSync(baseDir + name, { encoding: "utf-8" }));
        for (const prData of Object.values(data))
            timeArray.push(Math.trunc(Date.parse((prData as any)["create"]) / 1000));
    }
    timeArray.sort();
    return timeArray
}

function generateTimeDicts() {
    const timeArray: number[] = [];
    const timedDict: Record<number, any> = {};
    for (const item of Object.values(cnameDict)) {
        const historyItems = item["history"];
        for (let i = 0; i < historyItems.length; i++) {
            const historyItem = historyItems[i];
            const year = new Date(historyItem["time"] * 1000).getUTCFullYear();
            let timedDictItem, timedItem, time: number;
            if (timedDict.hasOwnProperty(year)) {
                timedDictItem = timedDict[year]
            } else {
                timedDictItem = { "^updateTime": Math.trunc(updateTime.getTime() / 1000) }
                timedDict[year] = timedDictItem
            }
            if (isRemoveHistory(historyItem) && (i == 0 || !isRemoveHistory(historyItems[i - 1]))) {
                time = -historyItem["time"]
                timeArray.push(time);
                if (timedDictItem.hasOwnProperty(time)) {
                    timedItem = timedDictItem[time]
                    if (Array.isArray(timedItem))
                        timedItem.push(item["name"]);
                    else
                        timedDictItem[time] = [timedItem, item["name"]]
                } else {
                    timedDictItem[time] = item["name"]
                }
            } else if ((!isRemoveHistory(historyItem)) && (i == 0 || isRemoveHistory(historyItems[i - 1]))) {
                time = historyItem["time"]
                timeArray.push(time);
                if (timedDictItem.hasOwnProperty(time)) {
                    timedItem = timedDictItem[time]
                    if (Array.isArray(timedItem))
                        timedItem.push(item["name"]);
                    else
                        timedDictItem[time] = [timedItem, item["name"]]
                } else {
                    timedDictItem[time] = item["name"]
                }
            }
        }
    }
    timeArray.sort((a, b) => Math.abs(a) - Math.abs(b));
    const resultArray: (number | number[])[] = [];
    let i = 0;
    const length = timeArray.length;
    while (i < length) {
        let count = 1;
        const time = timeArray[i];
        while (i + 1 < length && timeArray[i + 1] == time) {
            i += 1
            count += 1
        }
        if (count == 1)
            resultArray.push(time);
        else
            resultArray.push([time, count]);
        i += 1
    }
    const resultDict = { "^updateTime": Math.trunc(updateTime.getTime() / 1000) };
    resultDict["data"] = resultArray
    resultDict["prData"] = generatePrTimeArray()
    for (const timedDictItem of Object.values(timedDict))
        for (const timedItem of Object.values(timedDictItem))
            if (Array.isArray(timedItem))
                timedItem.sort()
    return [resultDict, timedDict];
}

function generateTimeDomains() {
    const timeDomains: Record<string, number> = { "^updateTime": Math.trunc(updateTime.getTime() / 1000) };
    for (const item of Object.values(cnameDict))
        if (item["history"][item["history"].length - 1]["type"] != "remove")
            timeDomains[item["name"]] = item["history"][0]["time"]
    return timeDomains
}

parseFullItems()
const commitItems = generateCommitItems();
const cnameStat = generateCnameStat();
const filteredDict = generateFilteredDict();
const [timeDict, timedDict] = generateTimeDicts();
const timeDomains = generateTimeDomains();

// shutil.rmtree("dist", ignore_errors=True)
if (!existsSync("dist"))
    mkdirSync("dist", { recursive: true });

{
    const cnameDictWithTime = { "^updateTime": Math.trunc(updateTime.getTime() / 1000) };
    Object.assign(cnameDictWithTime, cnameDict);
    writeFileSync("dist/cname.json", JSON.stringify(cnameDictWithTime, null, 1), { encoding: "utf-8" });
}

{
    const commitItemsWithTime = { "^updateTime": Math.trunc(updateTime.getTime() / 1000) };
    Object.assign(commitItemsWithTime, commitItems);
    writeFileSync("dist/commit.json", JSON.stringify(commitItemsWithTime, null, 1), { encoding: "utf-8" });
}

{
    const cnameStatWithTime = { "^updateTime": Math.trunc(updateTime.getTime() / 1000) };
    Object.assign(cnameStatWithTime, cnameStat);
    writeFileSync("dist/stat.json", JSON.stringify(cnameStatWithTime, null, 1), { encoding: "utf-8" });
}

{
    const cnameStatSimple = { "^updateTime": Math.trunc(updateTime.getTime() / 1000) }
    for (const item of Object.keys(cnameStat))
        cnameStatSimple[item] = cnameStat[item].length;
    writeFileSync("dist/statSimple.json", JSON.stringify(cnameStatSimple), { encoding: "utf-8" });
}

for (const [firstStr, item] of Object.entries(filteredDict)) {
    item["^updateTime"] = Math.trunc(updateTime.getTime() / 1000);
    writeFileSync(`dist/${firstStr}.json`, JSON.stringify(item), { encoding: "utf-8" });
}

writeFileSync("dist/times.json", JSON.stringify(timeDict), { encoding: "utf-8" });

for (const [year, timedItem] of Object.entries(timedDict))
    writeFileSync(`dist/year${year}.json`, JSON.stringify(timedItem), { encoding: "utf-8" });

writeFileSync("dist/live.json", JSON.stringify(timeDomains), { encoding: "utf-8" });

// stats
{
    let content = "# JS.ORG Stats\n";
    content += `- **Updated time:** ${updateTime.toISOString()}\n`;
    content += `- **Total subdomains:** ${Object.keys(cnameDict).length}\n`;
    content += `- **Live subdomains:** ${Object.keys(timeDomains).length - 1}\n`;  // remove `^updateTime`
    writeFileSync("dist/README.md", content, { encoding: "utf-8" });
}
