// Generated terminal workload; never a model/provider invocation.
if (process.argv.includes('--burst')) {
  let index = 0;
  const timer = setInterval(() => {
    for (let i = 0; i < 10; i++)
      process.stdout.write(`\x1b[32mPA_PERF_LINE_${index++} 中文🙂\x1b[0m\r\n`);
    if (index >= 3000) {
      clearInterval(timer);
      process.stdout.write('PA_PERF_DONE\r\n');
    }
  }, 10);
} else process.stdout.write('PA_PERF_READY\r\n');
