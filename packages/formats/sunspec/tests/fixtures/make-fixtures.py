# The registers of a device and what the SunSpec Alliance's own reader,
# pysunspec2, computes from them: the reference the tests hold this package to.
#
#   git clone --depth 1 https://github.com/sunspec/pysunspec2.git
#   git clone --depth 1 https://github.com/sunspec/models.git
#   python3 make-fixtures.py <pysunspec2> <models> <device.json> <out.json>
#
# <device.json> lists models with their raw values, as pysunspec2 reads a
# device from a file (site.input.json here; device_1547.json and
# inverter_123.json are pysunspec2's own test data, Apache-2.0).
import json
import sys

pysunspec2, models, src, out = sys.argv[1:5]
sys.path.insert(0, pysunspec2)
import sunspec2.device as device  # noqa: E402
import sunspec2.file.client as client  # noqa: E402

device.set_model_defs_path([models])
d = client.FileClientDevice(src)
d.scan()
registers = [0x5375, 0x6E53]
read = []
for m in d.model_list:
    b = m.get_mb()
    registers += [int.from_bytes(b[i:i + 2], 'big') for i in range(0, len(b), 2)]
    read.append({'id': m.model_id, 'computed': m.get_dict(computed=True)})
registers += [0xFFFF, 0]
json.dump({'baseAddress': 40000, 'registers': registers, 'models': read}, open(out, 'w'), separators=(',', ':'))
