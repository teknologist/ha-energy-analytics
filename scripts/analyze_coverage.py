#!/usr/bin/env python3
"""Analyze lcov.info to determine what needs to be tested to reach 80% coverage."""

import re
from collections import defaultdict

def parse_lcov(filename):
    """Parse lcov.info file and extract coverage data."""
    files = defaultdict(lambda: {'lines': {}, 'total_lines': 0, 'covered_lines': 0})

    current_file = None
    in_lf = False
    lf_count = 0
    lh_count = 0

    with open(filename, 'r') as f:
        for line in f:
            line = line.strip()
            if line.startswith('SF:'):
                current_file = line[3:]
                in_lf = False
            elif line.startswith('LF:'):
                lf_count = int(line[3:])
                in_lf = True
            elif line.startswith('LH:'):
                lh_count = int(line[3:])
            elif line.startswith('end_of_record'):
                if current_file and in_lf:
                    files[current_file]['total_lines'] = lf_count
                    files[current_file]['covered_lines'] = lh_count
                in_lf = False
            elif line.startswith('DA:'):
                if current_file:
                    parts = line[3:].split(',')
                    line_num = int(parts[0])
                    hit_count = int(parts[1]) if len(parts) > 1 else 0
                    files[current_file]['lines'][line_num] = hit_count

    return files

def main():
    files = parse_lcov('coverage/lcov.info')

    total_lines = 0
    total_covered = 0

    print("\n=== Coverage Analysis ===\n")
    print(f"{'File':<40} {'Covered':>10} {'Total':>10} {'Coverage':>10} {'To 80%':>10}")
    print("-" * 90)

    for file in sorted(files.keys()):
        data = files[file]
        covered = data['covered_lines']
        total = data['total_lines']
        coverage = (covered / total * 100) if total > 0 else 0
        needed_for_80 = int(total * 0.8) - covered

        total_lines += total
        total_covered += covered

        short_name = file.replace('/Users/eric/Dev/energy-tracker/', '')[:40]
        print(f"{short_name:<40} {covered:>10} {total:>10} {coverage:>9.1f}% {needed_for_80:>10}")

    overall_coverage = (total_covered / total_lines * 100) if total_lines > 0 else 0
    needed_for_80 = int(total_lines * 0.8) - total_covered

    print("-" * 90)
    print(f"{'TOTAL':<40} {total_covered:>10} {total_lines:>10} {overall_coverage:>9.1f}% {needed_for_80:>10}")
    print()

    current_coverage = overall_coverage
    target = 80.0
    print(f"Current Coverage: {current_coverage:.1f}%")
    print(f"Target Coverage: {target:.1f}%")
    print(f"Lines Needed: {max(0, needed_for_80)}")
    print()

    # Analyze which files contribute most to the gap
    print("=== Files with Lowest Coverage (prioritized for testing) ===")
    file_coverage = []
    for file, data in files.items():
        if data['total_lines'] > 0:
            coverage = data['covered_lines'] / data['total_lines']
            uncovered = data['total_lines'] - data['covered_lines']
            file_coverage.append((file, coverage, uncovered))

    file_coverage.sort(key=lambda x: x[1])  # Sort by coverage (lowest first)

    for file, coverage, uncovered in file_coverage[:5]:
        short_name = file.replace('/Users/eric/Dev/energy-tracker/', '')
        print(f"  {short_name:<50} {coverage*100:>5.1f}% ({uncovered} lines uncovered)")

if __name__ == '__main__':
    main()
