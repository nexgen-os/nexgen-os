import { describe, expect, it } from 'vitest';
import {
  discover,
  instancesOf,
  matchDiscovered,
  MdnsError,
  queryOf,
  readMessage,
  serviceType,
  writeMessage,
  type DnsRecord,
  type MdnsTransport,
} from '@nexgen-os/mdns';

const label = (s: string) => [s.length, ...Buffer.from(s)];

/**
 * An answer as a responder writes it, byte by byte, with compressed names:
 * a PTR to an instance of `_hwenergy._tcp.local`, its SRV and TXT, and the
 * host's A record, the names after the first pointing back into it.
 */
function compressedAnswer(): Buffer {
  const head = [0, 0, 0x84, 0x00, 0, 0, 0, 1, 0, 0, 0, 3];
  // offset 12: _hwenergy._tcp.local
  const service = [...label('_hwenergy'), ...label('_tcp'), ...label('local'), 0];
  const ptrHead = [0, 12, 0, 1, 0, 0, 0x11, 0x94];
  // rdata: "P1 meter" + pointer to 12
  const ptrData = [...label('P1 meter'), 0xc0, 12];
  const ptr = [...service, ...ptrHead, 0, ptrData.length, ...ptrData];
  const instanceAt = 12 + service.length + ptrHead.length + 2; // the rdata of the PTR
  // SRV: name = pointer to the instance; target = p1meter-0a1b2c + pointer to "local" (12 + 10 + 5)
  const localAt = 12 + label('_hwenergy').length + label('_tcp').length;
  const srvData = [0, 0, 0, 0, 0, 80, ...label('p1meter-0a1b2c'), 0xc0, localAt];
  const srv = [0xc0, instanceAt, 0, 33, 0x80, 1, 0, 0, 0, 120, 0, srvData.length, ...srvData];
  const txtData = [...label('api_enabled=1'), ...label('product_type=HWE-P1'), ...label('path=/api/v1'), ...label('API_ENABLED=0')];
  const txt = [0xc0, instanceAt, 0, 16, 0x80, 1, 0, 0, 0x11, 0x94, 0, txtData.length, ...txtData];
  const srvTargetAt = 12 + ptr.length + 2 + 8 + 2 + 6; // the target name inside the SRV rdata
  const a = [0xc0, srvTargetAt, 0, 1, 0x80, 1, 0, 0, 0, 120, 0, 4, 192, 168, 1, 42];
  return Buffer.from([...head, ...ptr, ...srv, ...txt, ...a]);
}

describe('readMessage', () => {
  it('reads an answer whose names are compressed', () => {
    const m = readMessage(compressedAnswer());
    expect(m.response).toBe(true);
    expect(m.records).toEqual([
      { name: '_hwenergy._tcp.local', type: 'PTR', ttl: 4500, data: 'P1 meter._hwenergy._tcp.local' },
      {
        name: 'P1 meter._hwenergy._tcp.local',
        type: 'SRV',
        ttl: 120,
        data: { priority: 0, weight: 0, port: 80, target: 'p1meter-0a1b2c.local' },
      },
      {
        name: 'P1 meter._hwenergy._tcp.local',
        type: 'TXT',
        ttl: 4500,
        data: { api_enabled: '1', product_type: 'HWE-P1', path: '/api/v1' },
      },
      { name: 'p1meter-0a1b2c.local', type: 'A', ttl: 120, data: '192.168.1.42' },
    ]);
  });

  it('refuses a message cut short, and a name that points to itself', () => {
    const whole = compressedAnswer();
    expect(() => readMessage(whole.subarray(0, whole.length - 3))).toThrow(/^message_invalid/);
    const loop = Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0xc0, 12, 0, 12, 0, 1, 0, 0, 0, 1, 0, 0]);
    expect(() => readMessage(loop)).toThrow(MdnsError);
    expect(() => readMessage(Buffer.from([0, 0]))).toThrow(/^message_invalid/);
  });

  it('reads back what writeMessage wrote, IPv6 included', () => {
    const records: DnsRecord[] = [
      { name: '_http._tcp.local', type: 'PTR', ttl: 4500, data: 'Station._http._tcp.local' },
      { name: 'Station._http._tcp.local', type: 'SRV', ttl: 120, data: { priority: 1, weight: 2, port: 8080, target: 'station.local' } },
      { name: 'Station._http._tcp.local', type: 'TXT', ttl: 4500, data: { secure: true, v: '2' } },
      { name: 'station.local', type: 'AAAA', ttl: 120, data: 'fe80::1:abcd' },
      { name: 'station.local', type: 'AAAA', ttl: 120, data: '2001:db8:0:1:0:0:0:1' },
    ];
    const back = readMessage(writeMessage({ response: true, records }));
    expect(back.records.slice(0, 4)).toEqual(records.slice(0, 4));
    expect(back.records[4]!.data).toBe('2001:db8:0:1::1');
  });

  it('skips the record types DNS-SD does not read', () => {
    const nsec = [...label('x'), ...label('local'), 0, 0, 47, 0, 1, 0, 0, 0, 1, 0, 2, 0xab, 0xcd];
    const m = readMessage(Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0, ...nsec]));
    expect(m.records).toEqual([]);
  });
});

describe('queryOf', () => {
  it('asks for the PTR records of each service type', () => {
    const m = readMessage(queryOf(['_hwenergy._tcp', '_http._tcp.local.']));
    expect(m.response).toBe(false);
    expect(m.questions).toEqual([
      { name: '_hwenergy._tcp.local', type: 'PTR' },
      { name: '_http._tcp.local', type: 'PTR' },
    ]);
  });

  it('refuses what is not a service type', () => {
    expect(() => serviceType('hwenergy')).toThrow(/^service_invalid/);
    expect(() => queryOf(['_x._sctp'])).toThrow(/^service_invalid/);
    expect(serviceType('_go-e_go-eCharger._tcp')).toBe('_go-e_go-eCharger._tcp');
  });
});

describe('instancesOf', () => {
  const records = readMessage(compressedAnswer()).records;

  it('assembles an instance from its PTR, SRV, TXT and A records', () => {
    expect(instancesOf(records)).toEqual([
      {
        name: 'P1 meter',
        service: '_hwenergy._tcp',
        host: 'p1meter-0a1b2c',
        port: 80,
        addresses: ['192.168.1.42'],
        txt: { api_enabled: '1', product_type: 'HWE-P1', path: '/api/v1' },
      },
    ]);
  });

  it('keeps an instance whose SRV has not come yet, and leaves out one that said goodbye', () => {
    const ptrOnly = records.filter((r) => r.type === 'PTR');
    expect(instancesOf(ptrOnly)).toEqual([
      { name: 'P1 meter', service: '_hwenergy._tcp', host: null, port: null, addresses: [], txt: {} },
    ]);
    const goodbye: DnsRecord = { ...(records[0] as DnsRecord & { type: 'PTR' }), ttl: 0 };
    expect(instancesOf([...records, goodbye])).toEqual([]);
  });

  it('leaves out the service types not asked for', () => {
    expect(instancesOf(records, ['_http._tcp'])).toEqual([]);
    expect(instancesOf(records, ['_HWEnergy._tcp'])).toHaveLength(1);
  });
});

describe('matchDiscovered', () => {
  const found = instancesOf(readMessage(compressedAnswer()).records);

  it('gives each service the catalogue entries it may be, by service type or host name', () => {
    const catalogue = [
      { key: 'meter/a', mdns: ['_hwenergy._tcp'] },
      { key: 'meter/b', hostname: ['P1METER-*'] },
      { key: 'charger/c', mdns: ['_go-e_go-eCharger._tcp'], hostname: ['go-echarger*'] },
    ];
    expect(matchDiscovered(found, catalogue).map((m) => m.keys)).toEqual([['meter/a', 'meter/b']]);
    expect(matchDiscovered(found, [catalogue[2]!])).toEqual([{ service: found[0], keys: [] }]);
  });
});

describe('discover', () => {
  it('sends its query twice and reads what answers, skipping what it cannot read', async () => {
    const sent: Buffer[] = [];
    let listener: (m: Buffer) => void = () => {};
    let closed = false;
    const transport: MdnsTransport = {
      send(m) {
        sent.push(m);
        if (sent.length === 1) {
          listener(Buffer.from([1, 2, 3]));
          listener(queryOf(['_hwenergy._tcp'])); // another querier's question, not an answer
          listener(compressedAnswer());
        }
      },
      onMessage(l) {
        listener = l;
      },
      close() {
        closed = true;
      },
    };
    const result = await discover({ services: ['_hwenergy._tcp'], timeoutMs: 30, transport });
    expect(sent).toHaveLength(2);
    expect(readMessage(sent[0]!).questions).toEqual([{ name: '_hwenergy._tcp.local', type: 'PTR' }]);
    expect(closed).toBe(true);
    expect(result.unreadable).toBe(1);
    expect(result.services.map((s) => [s.name, s.addresses])).toEqual([['P1 meter', ['192.168.1.42']]]);
  });
});
