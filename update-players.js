#!/usr/bin/env node

/*
  Usage:

    node update-players.js players.json players-updated.js index-updated.html

  What it does:

    1. Reads players JSON array from players.json
    2. Writes gzip+base64 JS payload:
         window.playersDataGzipBase64 = "...";
    3. Reads index.html from current folder
    4. Writes updated-index.html:
         - updates visible date to today's date
         - updates <script src="...players....js"> to output JS filename

  It DOES NOT read old players.js.
  It DOES NOT merge.
  It assumes players.json is already the final/latest list.
*/

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [
  ,
  ,
  inputPlayersJson = 'players.json',
  outputPlayersJs = 'players.js',
  outputIndexHtml = 'index-updated.html',
  inputIndexHtml = 'index.html',
] = process.argv;

function formatTodayDate(date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

function formatCacheVersion(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  return `${year}${month}${day}-${hour}${minute}`;
}

function readPlayersJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error(`${filePath} must contain a JSON array`);
  }

  return data;
}

function writeCompressedPlayersJs(filePath, players) {
  const json = JSON.stringify(players);
  const gzipBase64 = zlib.gzipSync(json, { level: 9 }).toString('base64');

  const content =
`// Gzipped JSON payload. index.html decodes this into window.playersData at boot.
window.playersDataGzipBase64 = ${JSON.stringify(gzipBase64)};
`;

  fs.writeFileSync(filePath, content);
}

function updateIndexHtml({
  inputPath,
  outputPath,
  outputPlayersJs,
  dateText,
  cacheVersion,
}) {
  let html = fs.readFileSync(inputPath, 'utf8');

  const outputPlayersJsName = path.basename(outputPlayersJs);

  /*
    Update script line, for example:

      <script src="players.js?v=20260623-449"></script>

    becomes:

      <script src="players-updated.js?v=20260629-1230"></script>
  */
  html = html.replace(
    /<script\s+src=["'][^"']*players[^"']*\.js(?:\?v=[^"']*)?["']\s*><\/script>/i,
    `<script src="${outputPlayersJsName}?v=${cacheVersion}"></script>`
  );

  /*
    Update title date, for example:

      pickleball players on 26/06/2026

    becomes today's date.
  */
  html = html.replace(
    /(pickleball players on )\d{2}\/\d{2}\/\d{4}/i,
    `$1${dateText}`
  );

  fs.writeFileSync(outputPath, html);
}

function verifyCompressedPlayersJs(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');

  const match = raw.match(
    /window\.playersDataGzipBase64\s*=\s*(['"])([\s\S]*?)\1\s*;?/
  );

  if (!match) {
    throw new Error(`${filePath} does not contain window.playersDataGzipBase64`);
  }

  const decoded = zlib.gunzipSync(Buffer.from(match[2], 'base64')).toString('utf8');
const players = JSON.parse(decoded);

  if (!Array.isArray(players)) {
    throw new Error(`${filePath} decoded payload is not a JSON array`);
  }

  return players.length;
}

function main() {
  const today = new Date();
  const dateText = formatTodayDate(today);
  const cacheVersion = formatCacheVersion(today);

  const players = readPlayersJson(inputPlayersJson);

  writeCompressedPlayersJs(outputPlayersJs, players);

  updateIndexHtml({
    inputPath: inputIndexHtml,
    outputPath: outputIndexHtml,
    outputPlayersJs,
    dateText,
    cacheVersion,
  });

  const verifiedCount = verifyCompressedPlayersJs(outputPlayersJs);

  const inputSize = fs.statSync(inputPlayersJson).size;
  const outputSize = fs.statSync(outputPlayersJs).size;

  console.log(`Read:     ${inputPlayersJson}`);
  console.log(`Players:  ${players.length}`);
  console.log(`Wrote:    ${outputPlayersJs}`);
  console.log(`Verified: ${verifiedCount} players decoded from gzip payload`);
  console.log(`Wrote:    ${outputIndexHtml}`);
  console.log(`Date:     ${dateText}`);
  console.log(`Script:   ${path.basename(outputPlayersJs)}?v=${cacheVersion}`);
  console.log(`Size:     ${inputSize} bytes JSON -> ${outputSize} bytes JS gzip+base64`);
}

main();
