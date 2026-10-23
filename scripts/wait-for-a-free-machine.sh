#!/bin/sh
# Waits until no other test suite runs on this machine, for a self-hosted
# runner that shares its machine with other work: a machine that allows one
# test suite at a time stops the second one, so the job waits its turn
# rather than being stopped. Gives up after 30 minutes.
#
#   sh scripts/wait-for-a-free-machine.sh
#
# Only a Node process running a test runner counts: another program whose
# command line merely mentions one (an editor, an agent given a prompt that
# names it) does not hold the machine. The bracket keeps this script's own
# command line from matching.
pattern='^[^ ]*node .*(vi[t]est|[j]est|[p]laywright test)'
for _ in $(seq 1 120); do
  pgrep -f "$pattern" >/dev/null || exit 0
  sleep 15
done
echo "another test suite has held this machine for 30 minutes:"
pgrep -fl "$pattern"
exit 1
