import { verifyEvidence } from './evidence/provenance.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/verify-evidence.mjs reports/validation/<run>/evidence.json');
  } else {
    if (args.length !== 1)
      throw new Error('Supply one existing evidence envelope path under reports.');
    const result = await verifyEvidence(process.cwd(), args[0]);
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          status: 'verified-content-binding',
          origin: result.origin,
          commit: result.source.commit,
          contentSha256: result.source.contentSha256,
          artifacts: result.artifacts,
          independentExecutionProof: false,
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
