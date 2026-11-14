#!/bin/sh
# A made-up hub connector for StudioManager's tests and hand checks (contract:
# docs/hub-connector.md). POSIX sh, no dependency. The mode is read from
# ${TMPDIR:-/tmp}/sm-demo-hub-mode (default "ok"): ok, slow, garbage, huge, fail,
# bad-dates, hostile-open, unsupported, capture-slow.
# Usage: connector.sh counts | open [id] | events | questions | capture (JSON on stdin)

mode=ok
modefile="${TMPDIR:-/tmp}/sm-demo-hub-mode"
if [ -f "$modefile" ]; then
  mode=$(head -n 1 "$modefile" | tr -d '[:space:]')
  [ -n "$mode" ] || mode=ok
fi
req="$1"
here=$(cd "$(dirname "$0")" && pwd)

case "$mode" in
  slow) sleep 60; exit 0 ;;
  garbage)
    printf 'Traceback (most recent call last):\n  File "connector.py", line 3, in <module>\n    main()\nKeyError: hub\n'
    exit 0 ;;
  huge) head -c 2097152 /dev/zero | tr '\0' 'x'; exit 0 ;;
  fail) echo "Demo hub: the store is locked" >&2; exit 1 ;;
  unsupported) printf '{"version":1,"error":"unsupported"}\n'; exit 0 ;;
  capture-slow) [ "$req" = capture ] && sleep 40 ;;
esac

# Dates over the current and the next month (days 1 to 28 exist in every month).
y=$(date +%Y)
m=$(date +%m | sed 's/^0//')
ny=$y
nm=$((m + 1))
if [ "$nm" -gt 12 ]; then nm=1; ny=$((y + 1)); fi
cur=$(printf '%04d-%02d' "$y" "$m")
nxt=$(printf '%04d-%02d' "$ny" "$nm")

events_ok='{"id":"ev-1","title":"Poster tool: presets","start":"'$cur'-03"},
{"id":"ev-2","title":"Winter fair","start":"'$cur'-10","note":"Booth setup"},
{"id":"ev-3","title":"Upkeep: template check","start":"'$cur'-15","end":"'$cur'-17","note":"Three days"},
{"id":"ev-4","title":"Poster tool: review","start":"'$cur'-22"},
{"id":"ev-5","title":"Winter fair: teardown","start":"'$nxt'-05"},
{"id":"ev-6","title":"Upkeep: template check, again","start":"'$nxt'-12","end":"'$nxt'-12"}'

events_bad='{"id":"bad-1","title":"Not a day","start":"'$cur'-31x"},
{"id":"bad-2","title":"Impossible date","start":"2026-02-30"},
{"id":"bad-3","title":"Ends before it starts","start":"'$cur'-20","end":"'$cur'-10"},
{"id":"bad-4","title":"Too long","start":"2026-01-01","end":"2027-06-01"},
{"id":"bad-5","title":"Too early","start":"1999-12-31"}'

case "$req" in
  counts) printf '{"version":1,"waiting":3}\n' ;;
  open)
    id="$2"
    if [ "$mode" = hostile-open ]; then
      if [ -z "$id" ]; then
        printf '{"version":1,"url":"file:///etc/hosts"}\n'
      else
        printf '{"version":1,"path":"/etc/hosts"}\n'
      fi
    elif [ -z "$id" ]; then
      printf '{"version":1,"path":"%s"}\n' "$here/notes.txt"
    else
      printf '{"version":1,"url":"https://example.com/demo-hub/%s"}\n' "$id"
    fi ;;
  events)
    if [ "$mode" = bad-dates ]; then
      printf '{"version":1,"events":[%s,\n%s]}\n' "$events_ok" "$events_bad"
    else
      printf '{"version":1,"events":[%s]}\n' "$events_ok"
    fi ;;
  questions)
    printf '%s\n' '{"version":1,"questions":[{"id":"q-1","text":"Which preset should the poster tool open with?","since":"2026-10-20","recommendation":"The A3 preset"},{"id":"q-2","text":"Does the winter fair need a second booth?","since":"2026-10-28"},{"id":"q-3","text":"Keep the old template check?","recommendation":"Retire it"}]}' ;;
  capture)
    # Plain data on stdin; nothing is stored, the text only goes to stderr.
    cat >&2
    printf '{"version":1,"saved":true}\n' ;;
  *) printf '{"version":1,"error":"unsupported"}\n' ;;
esac
