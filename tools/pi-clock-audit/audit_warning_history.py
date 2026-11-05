"""Read-only audit of SEEQ EventLogger CSV. No camera/model/WebSocket needed."""
import argparse
import csv
from collections import deque
from datetime import datetime
import json
import math
from pathlib import Path
import sys


def audit_rows(filename, limit):
    rows = deque(maxlen=limit)
    errors = 0
    with Path(filename).open(encoding='utf-8-sig', newline='') as stream:
        for row in csv.DictReader(stream):
            if row.get('status') != 'SENT':
                continue
            try:
                logged = datetime.fromisoformat(row['time'])
                if logged.utcoffset() is None:
                    raise ValueError('time field has no timezone offset')
                payload_epoch = float(row['timestamp'])
                if not math.isfinite(payload_epoch):
                    raise ValueError('timestamp must be finite')
                logged_epoch = logged.timestamp()
                rows.append({
                    'event': row['event'],
                    'csv_time': row['time'],
                    'csv_epoch_s': logged_epoch,
                    'payload_timestamp_s': payload_epoch,
                    'age_after_send_approx_s': round(logged_epoch - payload_epoch, 3),
                })
            except (ValueError, KeyError, OverflowError) as exc:
                errors += 1
                print(f'[SKIP] {filename}: {exc}', file=sys.stderr)
    return rows, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv_file')
    parser.add_argument('--last', type=int, default=10)
    args = parser.parse_args()
    if args.last < 1:
        parser.error('--last must be positive')
    try:
        rows, errors = audit_rows(args.csv_file, args.last)
    except OSError as exc:
        parser.error(str(exc))
    for row in rows:
        print(json.dumps(row, ensure_ascii=False))
    print(f'[SUMMARY] SENT rows shown={len(rows)}, invalid SENT rows={errors}')
    print('[NOTE] CSV time is truncated to whole seconds. This is not an iPhone delivery acknowledgment.')


if __name__ == '__main__':
    main()
