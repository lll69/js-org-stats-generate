import fs from "node:fs";
const raw = String(fs.readFileSync("null_pulls.md", "utf-8")).split("\n");
console.log("{");
for (const line of raw) {
    const split = line.split("\t");
    if (split.length == 4) {
        console.log('    "' + split[3].replace(/https\:\/\/github\.com\/js\-org\/js\.org\/commit\//g, "") + '": ' +
            Number(split[2].replace(/https\:\/\/github\.com\/js\-org\/js\.org\/pull\//g, "")) + ", // " + split[1]);
    }
}
console.log("}");
