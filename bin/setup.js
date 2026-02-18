#!/usr/bin/env node

/**
 * Memory Mesh Setup Script - Singularity Edition (v3.2.3)
 * Installs YAMO skills, tools, and autonomous kernel modules.
 * Supports Standalone, Claude Code, Gemini CLI, and OpenClaw Singularity.
 */

import { fileURLToPath } from 'url';
import path, { dirname, join, resolve } from 'path';
import fs, { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { createInterface } from 'readline';
import process from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, '..');
const FORCE_MODE = process.argv.includes('--force') || process.argv.includes('-f');
const GLOBAL_MODE = process.argv.includes('--global') || process.argv.includes('-g');

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function promptUser(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${COLORS.yellow}${question}${COLORS.reset} `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim());
    });
  });
}

/**
 * Intelligent Environment Detection
 */
function detectEnvironment() {
  const cwd = process.cwd();
  const isOpenClaw = existsSync(join(cwd, '.openclaw')) || existsSync(join(cwd, 'AGENTS.md'));
  const isClaude = existsSync(join(homedir(), '.claude'));
  const isGemini = existsSync(join(homedir(), '.gemini'));
  
  return {
    cwd,
    isOpenClaw,
    isClaude,
    isGemini,
    home: homedir()
  };
}

/**
 * Ghost Protection for OpenClaw (AGENTS.md)
 */
async function applyGhostProtection(targetDir) {
  const agentsPath = join(targetDir, 'AGENTS.md');
  if (!existsSync(agentsPath)) return;

  log('\n⚓ Applying Ghost Protection to AGENTS.md...', 'blue');
  const content = readFileSync(agentsPath, 'utf-8');
  
  if (!content.includes('YAMO-NATIVE KERNEL')) {
    const protection = `> [!IMPORTANT]\n> **YAMO-NATIVE KERNEL v3.0 ACTIVE**\n> Prioritize BOOTSTRAP.yamo for session initialization.\n\n`;
    writeFileSync(agentsPath, protection + content);
    log('  ✓ Kernel pointer injected (Ghost Protection active)', 'green');
  } else {
    log('  ✓ Ghost Protection already active', 'green');
  }
}

/**
 * Deploy Singularity Kernel (BOOTSTRAP.yamo & Native Agent)
 */
async function deploySingularityKernel(targetDir) {
  log('\n🌌 Deploying YAMO-Native Singularity Kernel...', 'blue');
  
  // 1. Deploy BOOTSTRAP.yamo to root
  const bootstrapSrc = join(packageRoot, 'skills', 'BOOTSTRAP.yamo');
  const bootstrapDest = join(targetDir, 'BOOTSTRAP.yamo');
  
  if (existsSync(bootstrapSrc)) {
    await copyWithPrompt(bootstrapSrc, bootstrapDest, 'Singularity Bootstrap (BOOTSTRAP.yamo)');
  }

  // 2. Deploy Native Agent Modules
  const nativeAgentDir = join(targetDir, 'yamo-native-agent');
  if (!existsSync(nativeAgentDir)) {
    mkdirSync(nativeAgentDir, { recursive: true });
  }

  const skillsSrc = join(packageRoot, 'skills');
  
  // We want the structure to match the Unified OS/Native Agent expectations
  // skills/* -> yamo-native-agent/*
  await copyRecursive(skillsSrc, nativeAgentDir, 'Native Kernel');
}

/**
 * Recursive File Copy with Overwrite Prompt
 */
async function copyRecursive(src, dest, label) {
  if (!existsSync(src)) return;

  if (statSync(src).isDirectory()) {
    if (!existsSync(dest)) {
      mkdirSync(dest, { recursive: true });
    }
    const entries = readdirSync(src);
    for (const entry of entries) {
      await copyRecursive(join(src, entry), join(dest, entry), label);
    }
  } else {
    const fileName = path.basename(src);
    // Skip BOOTSTRAP.yamo in the recursive copy since it goes to the root
    if (fileName === 'BOOTSTRAP.yamo') return;
    
    await copyWithPrompt(src, dest, `${label}: ${fileName}`);
  }
}

async function copyWithPrompt(src, dest, label) {
  if (existsSync(dest) && !FORCE_MODE) {
    const answer = await promptUser(`${label} already exists at ${dest}. Overwrite? (y/n)`);
    if (answer !== 'y' && answer !== 'yes') {
      log(`  ⏭  Skipped ${label}`, 'yellow');
      return false;
    }
  }

  try {
    copyFileSync(src, dest);
    log(`  ✓ Installed ${label}`, 'green');
    return true;
  } catch (error) {
    log(`  ✗ Failed to install ${label}: ${error.message}`, 'red');
    return false;
  }
}

/**
 * Configure .env Substrate
 */
async function configureEnvironment(env) {
  log('\n⚙️  Auto-configuring semantic substrate (.env)...', 'blue');
  const envPath = join(env.cwd, '.env');
  
  const defaults = {
    LANCEDB_URI: env.isOpenClaw ? '/home/dev/workspace/runtime/data/lancedb' : './runtime/data/lancedb',
    EMBEDDING_MODEL_TYPE: 'local',
    EMBEDDING_MODEL_NAME: 'Xenova/all-MiniLM-L6-v2',
    EMBEDDING_DIMENSION: '384'
  };

  let existingEnv = '';
  if (existsSync(envPath)) {
    existingEnv = readFileSync(envPath, 'utf-8');
  }

  let updatedEnv = existingEnv;
  let changes = 0;

  for (const [key, value] of Object.entries(defaults)) {
    if (!updatedEnv.includes(`${key}=`)) {
      updatedEnv += `\n${key}=${value}`;
      changes++;
      log(`  + Set ${key}=${value}`, 'green');
    } else if (env.isOpenClaw && key === 'LANCEDB_URI' && !updatedEnv.includes(`LANCEDB_URI=${value}`)) {
      updatedEnv = updatedEnv.replace(/LANCEDB_URI=.*/, `LANCEDB_URI=${value}`);
      changes++;
      log(`  ✓ Linked to shared OpenClaw database: ${value}`, 'green');
    }
  }

  if (changes > 0) {
    try {
      writeFileSync(envPath, updatedEnv.trim() + '\n');
      log(`  ✓ Updated .env with ${changes} changes`, 'green');
    } catch (error) {
      log(`  ✗ Failed to update .env: ${error.message}`, 'red');
    }
  } else {
    log('  ✓ .env substrate is already optimized', 'green');
  }
}

/**
 * Install Standard Skills (Claude/Gemini)
 */
async function installStandardSkills(env) {
  log('\n📦 Installing Standard YAMO Skills...', 'blue');

  const targets = [];
  if (env.isClaude) targets.push({ name: 'Claude Code', dest: join(env.home, '.claude', 'skills', 'yamo-super') });
  if (env.isGemini) targets.push({ name: 'Gemini CLI', dest: join(env.home, '.gemini', 'skills', 'yamo-super') });

  if (targets.length === 0) {
    log('  ⚠ No standard AI CLI detected (Claude/Gemini). Skipping.', 'yellow');
    return;
  }

  const skillsSrc = join(packageRoot, 'skills');
  for (const target of targets) {
    log(`  Installing to ${target.name}...`, 'blue');
    await copyRecursive(skillsSrc, target.dest, target.name);
  }
}

/**
 * Install Tools (Local Project)
 */
async function installTools(env) {
  log('\n🔧 Installing Project Tools...', 'blue');
  const toolsDir = join(env.cwd, 'tools');

  if (!existsSync(toolsDir)) {
    mkdirSync(toolsDir, { recursive: true });
    log(`  ✓ Created ${toolsDir}`, 'green');
  }

  const toolFiles = [
    { src: 'memory_mesh.js', dest: 'memory_mesh.mjs', name: 'Memory Mesh CLI' }
  ];

  for (const { src, dest, name } of toolFiles) {
    const srcPath = join(packageRoot, 'bin', src);
    const destPath = join(toolsDir, dest);

    if (!existsSync(srcPath)) continue;

    let content = readFileSync(srcPath, 'utf-8');
    content = content.replace("import { MemoryMesh } from '../lib/memory/index.js';", "import { MemoryMesh } from '@yamo/memory-mesh';");
    content = content.replace("import { createLogger } from '../lib/utils/logger.js';", "");
    content = content.replace("const logger = createLogger('memory-mesh-cli');", "");

    if (existsSync(destPath) && !FORCE_MODE) {
      const answer = await promptUser(`${name} already exists. Overwrite? (y/n)`);
      if (answer !== 'y' && answer !== 'yes') {
        log(`  ⏭  Skipped ${name}`, 'yellow');
        continue;
      }
    }

    writeFileSync(destPath, content);
    log(`  ✓ Installed ${name} (as .mjs)`, 'green');
  }
}

async function createShortcuts(env) {
  log('\n⌨️  Creating shortcuts...', 'blue');
  const mmPath = join(env.cwd, 'mm');
  const toolScript = join(env.cwd, 'tools', 'memory_mesh.mjs');
  
  const content = `#!/bin/bash\nnode ${toolScript} "$@"\n`;
  
  try {
    writeFileSync(mmPath, content);
    fs.chmodSync(mmPath, '755');
    log('  ✓ Created local executable: ./mm', 'green');
  } catch (error) {
    log(`  ✗ Failed to create shortcut: ${error.message}`, 'red');
  }
}

function showUsage(env) {
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'));
  log('\n✨ Setup Complete!', 'bright');
  
  if (env.isOpenClaw) {
    log('\n🚀 SINGULARITY MODE ACTIVE:', 'cyan');
    log('  • Ghost Protection active in AGENTS.md', 'cyan');
    log('  • Kernel entry point: BOOTSTRAP.yamo', 'cyan');
    log('  • Modules deployed to: yamo-native-agent/', 'cyan');
    log(`  • Version: ${pkg.version}`, 'cyan');
    log('  • REFRESH SESSION to activate v3.0 fidelity.', 'cyan');
  } else {
    log('\n📚 STANDARD MODE:', 'blue');
    log('  • Skills installed to Claude/Gemini', 'blue');
    log('  • Use /yamo-super to start workflows', 'blue');
    log(`  • Version: ${pkg.version}`, 'blue');
  }

  log('\n🔧 Tools:', 'blue');
  log('  • ./mm <command>          (Quick Access)', 'blue');
  log('  • tools/memory_mesh.mjs   (Direct Script)', 'blue');
}

async function main() {
  log('\n╔════════════════════════════════════════╗', 'bright');
  log('║   Memory Mesh Setup - Singularity      ║', 'bright');
  log('║   Autonomous Kernel Installer          ║', 'bright');
  log('╚════════════════════════════════════════╝', 'bright');

  const env = detectEnvironment();

  try {
    // 1. Configure .env Substrate
    await configureEnvironment(env);

    // 2. OpenClaw Singularity Deployment
    if (env.isOpenClaw) {
      await applyGhostProtection(env.cwd);
      await deploySingularityKernel(env.cwd);
    }

    // 3. Standard CLI Skills (Claude/Gemini)
    // Only install if NOT in OpenClaw mode, OR if --global was explicitly requested
    if (!env.isOpenClaw || GLOBAL_MODE) {
      await installStandardSkills(env);
    } else {
      log('\n⏭  Skipping global CLI skills (use --global to force)', 'yellow');
    }

    // 4. Project Tools
    await installTools(env);

    // 5. Create 'mm' shortcut
    await createShortcuts(env);

    showUsage(env);
    
    log('');
    process.exit(0);
  } catch (error) {
    log(`\n✗ Setup failed: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

main();
