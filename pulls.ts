import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import { createInterface } from "node:readline";

async function sleep(ms: number) {
    await new Promise(r => setTimeout(r, ms));
}

async function input(question: string): Promise<string> {
    return await new Promise(r => {
        createInterface(stdin, stdout).question(question, r);
    });
}

(async () => {
    let GITHUB_TOKEN: string;

    if (argv.length != 3) {
        GITHUB_TOKEN = (await input("Enter GitHub Token: ")).trim();
        if (GITHUB_TOKEN.length == 0) {
            console.error("GITHUB_TOKEN is required");
            exit(1);
        }
    } else {
        GITHUB_TOKEN = argv[2];
    }
    const OUT_DIR = "dist/pulls";
    const MAX_TRIES = 16;

    if (!existsSync(OUT_DIR))
        mkdirSync(OUT_DIR, { recursive: true });

    const headers = {
        "Authorization": "Bearer " + GITHUB_TOKEN,
        "User-Agent": "LookupJsOrg",
    };

    const pullsData = {};

    let currentPage = 1;
    let tries = 0;
    let totalParsedPulls = 0;
    while (true) {
        if (tries >= MAX_TRIES) {
            console.error(`Tried for ${tries} times, exiting`);
            exit(1);
        }
        const url = `https://api.github.com/repos/js-org/js.org/pulls?state=all&per_page=100&page=${currentPage}`;
        const resp = await fetch(url, { headers: headers });
        if (resp.status != 200 && resp.status != 304) {
            const currentTime = Date.now();
            const resetTime = Number(resp.headers.get("x-ratelimit-reset") || (currentTime / 1000 + 10)) * 1000 - currentTime;
            console.log(`status=${resp.status}, sleep ${resetTime} ms`);
            await sleep(resetTime);
            tries += 1;
            continue;
        }
        tries = 0;
        const pulls = await resp.json() as any[];
        let parsedPulls = 0
        if (pulls.length == 0)
            break;
        let minPullNum = Infinity;
        let maxPullNum = 0;
        for (const pull of pulls) {
            const pullNum = Number(pull["number"]);
            const pullCreateTime: string | null = pull["created_at"];
            const pullCloseTime: string | null = pull["closed_at"];
            const pullMergeTime: string | null = pull["merged_at"];
            const pullMergeSha: string | null = pull["merge_commit_sha"];
            const pullUserId = Number(pull["user"]["id"]);

            if (pullNum == 0) {
                console.log("Invalid pull: " + pull);
                continue;
            }

            minPullNum = Math.min(pullNum, minPullNum);
            maxPullNum = Math.max(pullNum, maxPullNum);

            const pullDir = String(Math.floor(pullNum / 100));
            if (!pullsData.hasOwnProperty(pullDir))
                pullsData[pullDir] = {}
            pullsData[pullDir][pullNum] = {
                "create": pullCreateTime,
                "close": pullCloseTime,
                "merge": pullMergeTime,
                "sha": pullMergeSha,
                "userId": pullUserId,
            };
            parsedPulls += 1;
        }
        totalParsedPulls += parsedPulls;
        console.log(`Parsed ${parsedPulls} pulls in page ${currentPage} with PR Range ${minPullNum}-${maxPullNum}`);
        await sleep(1000);
        currentPage += 1;
    }

    for (const pullDir in pullsData) {
        const pullsSubData = pullsData[pullDir];
        writeFileSync(`${OUT_DIR}/${pullDir}.json`, JSON.stringify(pullsSubData), { encoding: "utf-8" });
    }
})();
