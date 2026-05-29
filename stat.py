#!/usr/bin/python3
from collections import deque
import re
import subprocess


class GitItem:
    def __init__(self, time: int, id: str, childIds: list[str], email: str, subject: str):
        self.time = time
        self.id = id
        self.childIds = childIds
        self.email = email
        self.subject = subject


originLine = subprocess.check_output(["/usr/bin/git", "-C", "js.org", "log", '--format=%at%n%H%n%P%n%ae%n%s%n'],
                                     text=True, encoding="utf-8")
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
    item = GitItem(timestamp * 1000, id, childIds, email, subject)
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

# The following Git commit short-circuited the normal history.
disallowedCommits = {
    "6adfd9149629ca99f9a8e9771f8f587e96f1d83a",  # Remove concurrency from validate workflow
    "bebcb082418bfc5876889c2bd5de40a4c15065dc",  # Enable concurrency for validate workflow
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
commitRegex = r"Merge pull request #(\d+) from (.*)"
for item in items:
    if isAllowed(item):
        match = re.match(commitRegex, item.subject)
        if match is not None:
            mergeItems.append(item)

fullItems: list[GitItem] = [mergeItems[0]]
for i in range(0, len(mergeItems)-1):
    bfsResult = bfs(mergeItems[i].id, mergeItems[i+1].id)
    for j in range(len(bfsResult)-2, -1, -1):
        fullItems.append(itemMap[bfsResult[j]])
fullItems.reverse()
for item in fullItems:
    print(item.id, item.email, item.subject)
