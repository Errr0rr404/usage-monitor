# Usage Monitor computer probe. Read-only: it prints numbers and changes nothing.
# Runs under /bin/sh on macOS and Linux. Each section starts with a @@name line.
LC_ALL=C
export LC_ALL
echo "@@os"; uname -s; uname -m
echo "@@host"; hostname 2>/dev/null
if [ "$(uname -s)" = "Darwin" ]; then
  echo "@@ncpu"; sysctl -n hw.ncpu
  echo "@@model"; sysctl -n machdep.cpu.brand_string 2>/dev/null
  echo "@@memsize"; sysctl -n hw.memsize
  echo "@@vmstat"; vm_stat
  echo "@@pressure"; sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null
  echo "@@memfree"; sysctl -n kern.memorystatus_level 2>/dev/null
  echo "@@load"; sysctl -n vm.loadavg
  echo "@@boottime"; sysctl -n kern.boottime
  echo "@@now"; date +%s
  echo "@@cpu"; iostat -n 0 -c 2 -w 1 2>/dev/null
  echo "@@gpu"; ioreg -r -d 1 -w 0 -c IOAccelerator 2>/dev/null | grep -E '"(model|PerformanceStatistics|VRAM,totalMB|IOClass)"'
  echo "@@top"; ps -Ao pcpu=,comm= -r 2>/dev/null | head -6
else
  echo "@@ncpu"; nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo
  echo "@@model"; grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2-
  echo "@@stat1"; head -1 /proc/stat
  sleep 1
  echo "@@stat2"; head -1 /proc/stat
  echo "@@meminfo"; grep -E '^(MemTotal|MemAvailable|MemFree|Buffers|Cached|SwapTotal|SwapFree):' /proc/meminfo
  echo "@@psi"; cat /proc/pressure/memory 2>/dev/null
  echo "@@loadavg"; cat /proc/loadavg
  echo "@@uptime"; cat /proc/uptime
  echo "@@nvidia"; nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null
  echo "@@top"; ps -eo pcpu=,comm= --sort=-pcpu 2>/dev/null | head -6
fi
if [ -d /System/Volumes/Data ]; then echo "@@df"; df -kP /System/Volumes/Data 2>/dev/null | tail -1; else echo "@@df"; df -kP / 2>/dev/null | tail -1; fi
echo "@@end"
