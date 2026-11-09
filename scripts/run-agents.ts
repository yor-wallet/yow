/**
 * DOOM | دوم — run the AI agents from the command line.
 *
 *   npm run agents:run                  # all agents (through the supervision agent)
 *   npm run agents:run -- --due         # only agents whose interval has elapsed (cron behaviour)
 *   npm run agents:run -- stock payments  # specific agents
 *   npm run agents:run -- --list        # list agents
 *
 * Agents only READ and PROPOSE; nothing is applied without a human approval in admin.
 */
try {
  process.loadEnvFile?.('.env');
} catch {
  /* rely on the environment */
}

async function main() {
  const { AGENTS } = await import('../lib/agents/registry');
  const { runAllAgents, runAgentByKey } = await import('../lib/agents/runner');
  const { prisma } = await import('../lib/db');
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    for (const a of AGENTS) console.log(`${String(a.number).padStart(2)}  ${a.key.padEnd(16)} every ${a.schedule.everyMinutes} min  scopes: ${a.scopes.join(', ')}`);
    return;
  }

  const keys = args.filter((a) => !a.startsWith('--'));
  const results = keys.length
    ? (await Promise.all(keys.map((k) => runAgentByKey(k, { trigger: 'cli' })))).flat()
    : await runAllAgents({ trigger: 'cli', onlyDue: args.includes('--due') });

  let failed = 0;
  for (const r of results) {
    if (r.status === 'FAILED') failed++;
    const p = r.proposals;
    console.log(
      `${r.status === 'SUCCEEDED' ? 'ok  ' : 'FAIL'} ${r.agentKey.padEnd(16)} ${String(r.durationMs).padStart(6)} ms  proposals: ${p.total} (${p.created} new, ${p.refreshed} refreshed)${r.error ? `  ${r.error}` : ''}`,
    );
  }
  await prisma.$disconnect();
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
