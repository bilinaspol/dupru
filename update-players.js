#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const [
  ,
  ,
  baseFileArg = 'players.js',
  todayFileArg = 'players.json',
  outFileArg = 'players-updated.js',
] = process.argv;

function readPlayers(filePath) {
  const fullPath = path.resolve(filePath);
  const raw = fs.readFileSync(fullPath, 'utf8').trim();

  // Supports normal JSON arrays and JS files like: window.playersData = [...]
  const jsonText = raw
    .replace(/^\s*window\.playersData\s*=\s*/, '')
    .replace(/;\s*$/, '');

  const data = JSON.parse(jsonText);
  if (!Array.isArray(data)) {
    throw new Error(`${filePath} must contain a JSON array of players`);
  }
  return data;
}

function playerKey(player) {
  if (player.duprId) return `dupr:${player.duprId}`;
  if (player.id) return `id:${player.id}`;
  return `name:${player.name ?? ''}|age:${player.age ?? ''}`;
}

function writePlayersJs(filePath, players) {
  fs.writeFileSync(
    filePath,
    `window.playersData =\n${JSON.stringify(players, null, 4)};\n`
  );
}

function main() {
  const basePlayers = readPlayers(baseFileArg);
  const todayPlayers = readPlayers(todayFileArg);

  const existingKeys = new Set(basePlayers.map(playerKey));
  const newPlayers = todayPlayers.filter(player => !existingKeys.has(playerKey(player)));
  const mergedPlayers = [...basePlayers, ...newPlayers];

  writePlayersJs(outFileArg, mergedPlayers);

  console.log(`Base ${baseFileArg}: ${basePlayers.length} player(s)`);
  console.log(`Today ${todayFileArg}: ${todayPlayers.length} player(s)`);
  console.log(`Added ${newPlayers.length} new player(s)`);
  console.log(`Wrote ${mergedPlayers.length} total player(s) to ${outFileArg}`);

  if (newPlayers.length) {
    console.log('\nAdded players:');
    console.table(newPlayers.map(player => ({
      mark: 'ADDED',
      name: player.name,
      age: player.age ?? '',
      doubles: player.doubles ?? '',
      singles: player.singles ?? '',
      duprId: player.duprId ?? '',
    })));
  }
}

main();
