// The meters and devices a stream of readings lands on, found and written by
// the core for the connector that receives them (`MeasuredObjects` of
// `@nexgen-os/connector`): the connector names an object by an identifier
// and hands its series; this reads the identifier under the connection's
// rights and writes through `store()`, so that the connector reaches
// neither the database nor the core (decision 0064).

import type { MeasuredFound, MeasuredObjects } from '@nexgen-os/connector';
import type { Db } from '../db.js';
import { storeSeries } from './interfaces.js';

export type { MeasuredFound, MeasuredObjects, MeasuredTarget } from '@nexgen-os/connector';

/**
 * The meters and devices of an installation, as a stream of readings asks
 * for them: by an identifier valid now, refused by name when it names none
 * (`identifier_unknown`), objects in more than one organisation
 * (`identifier_ambiguous`), something else than a meter or a device
 * (`object_not_measured`), or an object whose participant has no time zone
 * (`time_zone_required`); written as `measured` series of that object.
 */
export function measuredObjects(db: Db): MeasuredObjects {
  return {
    async byIdentifier(scheme, value, options = {}): Promise<MeasuredFound> {
      const { rows } = await db.query<{ organisation_id: string; object_kind: string; object_id: string; time_zone: string | null }>(
        `select i.organisation_id::text, i.object_kind, i.object_id::text, p.time_zone
           from identifiers i
           left join participants p on p.id = participant_of(i.object_kind, i.object_id)
          where i.scheme = $1 and i.value = $2
            and (i.valid_from is null or i.valid_from <= now())
            and (i.valid_to is null or i.valid_to > now())
            and ($3::uuid is null or i.organisation_id = $3::uuid)`,
        [scheme, value, options.organisationId ?? null],
      );
      const row = rows[0];
      if (!row) return { problem: { code: 'identifier_unknown', detail: `no meter or device is known by ${scheme} ${value}` } };
      if (rows.length > 1) {
        return { problem: { code: 'identifier_ambiguous', detail: `${scheme} ${value} names an object in ${rows.length} organisations; give organisationId` } };
      }
      if (row.object_kind !== 'meter' && row.object_kind !== 'device') {
        return { problem: { code: 'object_not_measured', detail: `${scheme} ${value} names a ${row.object_kind}, not a meter or a device` } };
      }
      if (!row.time_zone) {
        return { problem: { code: 'time_zone_required', detail: `the participant of ${row.object_kind} ${row.object_id} has no time zone: the meter's clock cannot be dated` } };
      }
      return { target: { organisationId: row.organisation_id, objectKind: row.object_kind, objectId: row.object_id, timeZone: row.time_zone } };
    },

    write(target, sourceCode, series) {
      return storeSeries(db, { organisationId: target.organisationId, objectKind: target.objectKind, objectId: target.objectId, sourceCode, kind: 'measured' }, series);
    },
  };
}
