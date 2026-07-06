#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [
  ,
  ,
  oldFileArg = 'players622.json',
  newFileArg = 'players.json',
  outFileArg = 'diff.json',
  absentFileArg = 'absent.json',
  mergedFileArg = oldFileArg,
  playersJsFileArg = 'players.js',
  indexFileArg = 'index.html',
  dateArg,
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

function readPlayers(filePath) {
  const fullPath = path.resolve(filePath);
  const raw = fs.readFileSync(fullPath, 'utf8').trim();

  let jsonText = raw;

  // Supports compressed JS files like:
  //   window.playersDataGzipBase64 = "...";
  const gzipMatch = raw.match(/window\.playersDataGzipBase64\s*=\s*(['"])([\s\S]*?)\1\s*;?/);
  if (gzipMatch) {
    jsonText = zlib.gunzipSync(Buffer.from(gzipMatch[2], 'base64')).toString('utf8');
  } else {
    // Supports normal JSON arrays and simple JS files like:
    //   window.playersData = [...];
    jsonText = raw
      .replace(/^\s*window\.playersData\s*=\s*/, '')
      .replace(/;\s*$/, '');
  }

  const data = JSON.parse(jsonText);
  if (!Array.isArray(data)) {
    throw new Error(`${filePath} must contain a JSON array of players`);
  }
  return data;
}

function writePlayersJson(filePath, players) {
  fs.writeFileSync(filePath, `${JSON.stringify(players, null, 2)}\n`);
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

function updateIndexHtml(filePath, playersJsFile, dateText, cacheVersion) {
  if (!fs.existsSync(filePath)) {
    console.log(`Skipped ${filePath}: file not found`);
    return false;
  }

  let html = fs.readFileSync(filePath, 'utf8');
  const before = html;
  const playersJsName = path.basename(playersJsFile);

  html = html.replace(
    /<script\s+src=["'][^"']*players[^"']*\.js(?:\?v=[^"']*)?["']\s*><\/script>/i,
    `<script src="${playersJsName}?v=${cacheVersion}"></script>`
  );

  html = html.replace(
    /(pickleball players on )\d{2}\/\d{2}\/\d{4}/i,
    `$1${dateText}`
  );

  if (html === before) {
    console.log(`Skipped ${filePath}: no script/date pattern changed`);
    return false;
  }

  fs.writeFileSync(filePath, html);
  return true;
}

function verifyCompressedPlayersJs(filePath) {
  return readPlayers(filePath).length;
}

function numericRating(value) {
  if (value === undefined || value === null || value === '' || value === 'NR') return null;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function formatDiff(value) {
  if (value === null) return undefined;
  const rounded = Number(value.toFixed(3));
  return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(3)}`;
}

function ratingDiff(newValue, oldValue) {
  const next = numericRating(newValue);
  const prev = numericRating(oldValue);

  // If one side is NR/missing and the other is numeric, treat it as a meaningful change,
  // but do not invent a numeric delta where there is no old/new numeric baseline.
  if (next === null || prev === null) {
    return next !== prev ? null : undefined;
  }

  const delta = next - prev;
  return Math.abs(delta) > 0.0005 ? delta : undefined;
}

function buildUpdatedPlayer(oldPlayer, newPlayer) {
  // Keep fields that existed only in the old local list, but refresh today's DUPR fields
  // (ratings, address, image, age, etc.) from the new scrape.
  return { ...oldPlayer, ...newPlayer };
}

function main() {
  const oldPlayers = readPlayers(oldFileArg);
  const newPlayers = readPlayers(newFileArg);
  const now = new Date();
  const runDate = dateArg ? parseDateArg(dateArg) : now;
  const dateText = dateArg || formatTodayDate(now);
  const cacheVersion = formatCacheVersion(runDate);

  const oldByDuprId = new Map(
    oldPlayers
      .filter(player => player.duprId)
      .map(player => [player.duprId, player])
  );

  const newByDuprId = new Map(
    newPlayers
      .filter(player => player.duprId)
      .map(player => [player.duprId, player])
  );

  const newDuprIds = new Set(newByDuprId.keys());
  const diffPlayers = [];
  let newCount = 0;
  let changedCount = 0;

  const absentPlayers = oldPlayers
    .filter(player => player.duprId && !newDuprIds.has(player.duprId))
    .map(player => ({ ...player, isAbsent: true }));

  for (const player of newPlayers) {
    const oldPlayer = oldByDuprId.get(player.duprId);

    if (!oldPlayer) {
      newCount += 1;
      diffPlayers.push({ ...player, isNew: true });
      continue;
    }

    const doublesDelta = ratingDiff(player.doubles, oldPlayer.doubles);
    const singlesDelta = ratingDiff(player.singles, oldPlayer.singles);

    if (doublesDelta !== undefined || singlesDelta !== undefined) {
      changedCount += 1;
      const changedPlayer = { ...player };

      if (doublesDelta === null) {
        changedPlayer['doubles-diff'] = `${oldPlayer.doubles ?? '—'} → ${player.doubles ?? '—'}`;
      } else if (doublesDelta !== undefined) {
        changedPlayer['doubles-diff'] = formatDiff(doublesDelta);
      }

      if (singlesDelta === null) {
        changedPlayer['singles-diff'] = `${oldPlayer.singles ?? '—'} → ${player.singles ?? '—'}`;
      } else if (singlesDelta !== undefined) {
        changedPlayer['singles-diff'] = formatDiff(singlesDelta);
      }

      diffPlayers.push(changedPlayer);
    }
  }

  const mergedPlayers = oldPlayers.map(oldPlayer => {
    const newPlayer = oldPlayer.duprId ? newByDuprId.get(oldPlayer.duprId) : undefined;
    return newPlayer ? buildUpdatedPlayer(oldPlayer, newPlayer) : oldPlayer;
  });

  const mergedDuprIds = new Set(
    mergedPlayers
      .filter(player => player.duprId)
      .map(player => player.duprId)
  );

  for (const newPlayer of newPlayers) {
    if (!newPlayer.duprId || !mergedDuprIds.has(newPlayer.duprId)) {
      mergedPlayers.push(newPlayer);
      if (newPlayer.duprId) mergedDuprIds.add(newPlayer.duprId);
    }
  }

  writePlayersJson(outFileArg, diffPlayers);
  writePlayersJson(absentFileArg, absentPlayers);
  writePlayersJson(mergedFileArg, mergedPlayers);
  writeCompressedPlayersJs(playersJsFileArg, mergedPlayers);
  const verifiedCount = verifyCompressedPlayersJs(playersJsFileArg);
  const indexUpdated = updateIndexHtml(indexFileArg, playersJsFileArg, dateText, cacheVersion);

  console.log(`Compared old=${oldFileArg} (${oldPlayers.length}) with new=${newFileArg} (${newPlayers.length})`);
  console.log(`Wrote ${diffPlayers.length} changed/new player(s) to ${outFileArg}`);
  console.log(`  NEW=${newCount}, CHANGED=${changedCount}`);
  console.log(`Wrote ${absentPlayers.length} absent player(s) to ${absentFileArg}`);
  console.log(`Wrote merged players to ${mergedFileArg}: ${oldPlayers.length} -> ${mergedPlayers.length}`);
  console.log(`Wrote ${playersJsFileArg}; verified ${verifiedCount} decoded player(s)`);
  console.log(indexUpdated ? `Updated ${indexFileArg}: date=${dateText}, script=${path.basename(playersJsFileArg)}?v=${cacheVersion}` : `Index unchanged: ${indexFileArg}`);

  if (diffPlayers.length) {
    console.log('\nChanged/new players:');
    console.table(diffPlayers.map(player => ({
      mark: player.isNew ? 'NEW' : 'CHANGED',
      name: player.name,
      age: player.age ?? '',
      doubles: player.doubles ?? '',
      'doubles-diff': player.isNew ? 'NEW' : (player['doubles-diff'] ?? ''),
      singles: player.singles ?? '',
      'singles-diff': player.isNew ? 'NEW' : (player['singles-diff'] ?? ''),
    })));
  }

  if (absentPlayers.length) {
    console.log('\nAbsent players:');
    console.table(absentPlayers.map(player => ({
      mark: 'ABSENT',
      name: player.name,
      age: player.age ?? '',
      doubles: player.doubles ?? '',
      singles: player.singles ?? '',
    })));
  }
}

function parseDateArg(value) {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return new Date();
  const [, day, month, year] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

main();
