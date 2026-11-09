# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

"""Verify that Windows app and setup executables contain every branded ICO image."""

from pathlib import Path
import struct
import sys


def main():
    icon = (Path(__file__).resolve().parent.parent / 'resources/win32/code.ico').read_bytes()
    reserved, kind, count = struct.unpack_from('<HHH', icon)
    if reserved != 0 or kind != 1 or count < 1:
        raise ValueError('Invalid application ICO')
    images = []
    for index in range(count):
        size, offset = struct.unpack_from('<II', icon, 6 + index * 16 + 8)
        if size == 0 or offset + size > len(icon):
            raise ValueError('Invalid ICO image range')
        images.append(icon[offset:offset + size])
    if len(sys.argv) < 2:
        raise ValueError('Pass application and/or installer executable paths')
    for name in sys.argv[1:]:
        executable = Path(name).read_bytes()
        for index, data in enumerate(images):
            if data not in executable:
                raise ValueError(f'{name}: missing branded icon image {index}')
        print(f'{name}: verified all {count} branded icon images')


if __name__ == '__main__':
    main()
