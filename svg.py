import datetime
import json
import math
import matplotlib.pyplot as plt

SECOND_PER_DAY = 60 * 60 * 24
MS_PER_DAY = 1000 * SECOND_PER_DAY

with open("dist/times.json", "r", encoding="utf-8") as file:
    rawData = json.load(file)
timeData = rawData["data"]
prData = rawData["prData"]


def getUtcDayMs(timeSecond):
    return math.floor(timeSecond / SECOND_PER_DAY) * SECOND_PER_DAY * 1000


def convertTime(item):
    return int(item[0] if type(item) == list else item)


def previousSpecialDay(date):
    if date.month == 1:
        return datetime.datetime(date.year - 1, 7, 1).timestamp() * 1000
    else:
        return datetime.datetime(date.year, 1, 1).timestamp() * 1000


def nextSpecialDay(date):
    if date.month == 1:
        return datetime.datetime(date.year, 7, 1).timestamp() * 1000
    else:
        return datetime.datetime(date.year + 1, 1, 1).timestamp() * 1000


def utcDayToLineData():
    minDayMs = min(getUtcDayMs(abs(convertTime(timeData[0]))) - MS_PER_DAY, getUtcDayMs(abs(convertTime(prData[0]))) - MS_PER_DAY)
    maxDayMs = max(getUtcDayMs(abs(convertTime(timeData[len(timeData) - 1]))), getUtcDayMs(abs(convertTime(prData[len(prData) - 1]))))
    totalDayCount = ((maxDayMs - minDayMs) // MS_PER_DAY) + 1
    x = [0] * totalDayCount
    y = [0] * totalDayCount
    y2 = [0] * totalDayCount
    specialDayMsList = []
    for i in range(totalDayCount):
        x[i] = minDayMs + i * MS_PER_DAY
        date = datetime.datetime.fromtimestamp(x[i] / 1000, tz=datetime.timezone.utc)
        if (date.month == 1 or date.month == 7) and date.day == 1:
            if len(specialDayMsList) == 0:
                specialDayMsList.append(previousSpecialDay(date))
            specialDayMsList.append(x[i])
    specialDayMsList.append(nextSpecialDay(datetime.datetime.fromtimestamp(specialDayMsList[len(specialDayMsList) - 1] / 1000, tz=datetime.timezone.utc)))

    currentDay = minDayMs
    count = 0
    for item in timeData:
        if type(item) != list:
            dayMs = getUtcDayMs(abs(item))
            delta = 1 if item > 0 else -1
        else:
            dayMs = getUtcDayMs(abs(item[0]))
            delta = int(item[1]) * (1 if item[0] > 0 else -1)

        if dayMs != currentDay:
            y[(currentDay - minDayMs) // MS_PER_DAY] = count
            currentDay = dayMs
            count = 0
        count += delta
    y[(currentDay - minDayMs) // MS_PER_DAY] = count
    for i in range(1, totalDayCount):
        y[i] += y[i - 1]

    currentDay = minDayMs
    count = 0
    for item in prData:
        dayMs = getUtcDayMs(abs(item))
        if dayMs != currentDay:
            y2[(currentDay - minDayMs) // MS_PER_DAY] = count
            currentDay = dayMs
            count = 0
        count += 1
    y2[(currentDay - minDayMs) // MS_PER_DAY] = count
    for i in range(1, totalDayCount):
        y2[i] += y2[i - 1]

    return [x, y, y2, specialDayMsList]


def msToUtcYearMonth(ms):
    date = datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc)
    return f"{date.year}-{date.month}"


x, y, y2, xSpecial = utcDayToLineData()
xSpecialLabel = list(map(msToUtcYearMonth, xSpecial))
plt.rcParams.update({"font.size": 20})

ax = plt.subplots(figsize=(16, 9))[1]
ax.plot(x, y, label="Total Subdomains")
ax.set_xticks(xSpecial)
ax.set_xticklabels(xSpecialLabel)
ax.tick_params("x", labelrotation=90)
ax.legend()
ax.grid()
ax.set_position((0, 0, 1, 1))
plt.savefig("dist/domains.svg", format="svg", bbox_inches="tight")

ax = plt.subplots(figsize=(16, 9))[1]
ax.plot(x, y2, label="Total PRs")
ax.set_xticks(xSpecial)
ax.set_xticklabels(xSpecialLabel)
ax.tick_params("x", labelrotation=90)
ax.legend()
ax.grid()
ax.set_position((0, 0, 1, 1))
plt.savefig("dist/prs.svg", format="svg", bbox_inches="tight")
