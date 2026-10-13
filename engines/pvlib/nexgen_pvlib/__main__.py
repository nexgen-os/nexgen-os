"""Reads one envelope on stdin, writes one answer on stdout: `python -m nexgen_pvlib`."""

import sys

from .run import main

if __name__ == "__main__":
    sys.exit(main())
