#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const [, , oldFileArg = 'players622.json', newFileArg = 'players.json', outFileArg = 'diff.json'] = process.argv;

function readPlayers(filePath) {
  const fullPath = path.resolve(filePath);
  const raw = fs.readFileSync(fullPath, 'utf8').trim();

  // Supports normal JSON arrays and simple JS files like: window.playersData = [...]
  const jsonText = raw
    .replace(/^\s*window\.playersData\s*=\s*/, '')
    .replace(/;\s*$/, '');

  const data = JSON.parse(jsonText);
  if (!Array.isArray(data)) {
    throw new Error(`${filePath} must contain a JSON array of players`);
  }
  return data;
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

function main() {
  const oldPlayers = readPlayers(oldFileArg);
  const newPlayers = readPlayers(newFileArg);

  const oldByDuprId = new Map(
    oldPlayers
      .filter(player => player.duprId)
      .map(player => [player.duprId, player])
  );

  const diffPlayers = [];

  for (const player of newPlayers) {
    const oldPlayer = oldByDuprId.get(player.duprId);

    if (!oldPlayer) {
      diffPlayers.push({ ...player, isNew: true });
      continue;
    }

    const doublesDelta = ratingDiff(player.doubles, oldPlayer.doubles);
    const singlesDelta = ratingDiff(player.singles, oldPlayer.singles);

    if (doublesDelta !== undefined || singlesDelta !== undefined) {
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

  fs.writeFileSync(outFileArg, `${JSON.stringify(diffPlayers, null, 2)}\n`);

  console.log(`Compared old=${oldFileArg} (${oldPlayers.length}) with new=${newFileArg} (${newPlayers.length})`);
  console.log(`Wrote ${diffPlayers.length} changed/new player(s) to ${outFileArg}`);

  if (diffPlayers.length) {
    console.table(diffPlayers.map(player => ({
      name: player.name,
      age: player.age ?? '',
      doubles: player.doubles ?? '',
      'doubles-diff': player.isNew ? 'NEW' : (player['doubles-diff'] ?? ''),
      singles: player.singles ?? '',
      'singles-diff': player.isNew ? 'NEW' : (player['singles-diff'] ?? ''),
    })));
  }
}

main();
