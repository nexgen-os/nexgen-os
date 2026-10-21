-- Nexgen OS — module `tasks`: the generic templates.
--
-- Two kinds of project go through the same steps in every country: a
-- photovoltaic installation on a roof, and an energy community sharing what
-- its members produce. The module publishes those steps once, for every
-- country (`country` null): a step's name says what is done, never under
-- which article. What one country adds — a named inspection body, a
-- regional authorisation, a purchase-contract or tender branch — is a
-- template its installation or a private overlay publishes under its own
-- name, with the reference it answers; a country pack holds no task.
--
-- A condition reads an attribute of the project (`applies_when`); the
-- templates below have none, so `tasks.plan()` gives every project of the
-- kind the whole list, in this order.

set search_path = nexgen, public, extensions;

insert into tasks.templates (code, published_by, country, project_kind, phase, role, name, description, documents, depends_on_code, position) values
  -- A photovoltaic installation on an existing roof.
  ('pv_roof_study',              'tasks', null, 'pv_roof', 'study',           'owner',         'Feasibility study: yield, self-consumption share, budget',
   'The roof, its orientation and shading, the participant''s consumption curve, the expected yield and the share self-consumed, the budget and the return.',
   '{"Feasibility report"}', null, 10),
  ('pv_roof_design',             'tasks', null, 'pv_roof', 'design',          'installer',     'Structural check of the roof and electrical design',
   'The roof carries the arrays; the strings, the inverter and the protections follow the electrical installation standard of the country.',
   '{"Structural note", "Single-line diagram"}', 'pv_roof_study', 20),
  ('pv_roof_authorisation',      'tasks', null, 'pv_roof', 'permitting',      'owner',         'Planning authorisation obtained or exemption checked',
   'Panels change the external aspect of a building: the planning authority of the place says whether a declaration, a permit or nothing is needed, and answers it.',
   '{"Authorisation or exemption"}', 'pv_roof_design', 30),
  ('pv_roof_connection_request', 'tasks', null, 'pv_roof', 'grid_connection', 'installer',     'Connection request filed with the distribution operator',
   'The request for injection, of the surplus or of the whole production, with the operator of the connection point, who answers with a connection proposal and its cost.',
   '{"Connection proposal"}', 'pv_roof_authorisation', 40),
  ('pv_roof_procurement',        'tasks', null, 'pv_roof', 'procurement',     'installer',     'Modules, inverter and mounting system ordered and delivered',
   null, '{"Order", "Delivery note", "Datasheets"}', 'pv_roof_authorisation', 50),
  ('pv_roof_installation',       'tasks', null, 'pv_roof', 'installation',    'installer',     'Arrays mounted and wired',
   null, '{"Photos of the installation"}', 'pv_roof_procurement', 60),
  ('pv_roof_conformity',         'tasks', null, 'pv_roof', 'commissioning',   'installer',     'Conformity inspection of the installation before use',
   'The body the country appoints checks the installation against the electrical standard before the operator energises it.',
   '{"Conformity certificate"}', 'pv_roof_installation', 70),
  ('pv_roof_energised',          'tasks', null, 'pv_roof', 'grid_connection', 'grid_operator', 'Connection energised and meter set for injection',
   'The distribution operator connects the installation and sets the meter to record what it injects; a purchase contract starts from this day.',
   '{"Commissioning report of the operator"}', 'pv_roof_conformity', 80),
  ('pv_roof_handover',           'tasks', null, 'pv_roof', 'handover',        'installer',     'Installation handed over with its file',
   'Diagrams, datasheets, warranties, the conformity certificate and the monitoring access, handed to the owner.',
   '{"Handover file"}', 'pv_roof_energised', 90),
  -- An energy community: members sharing the energy some of them produce.
  ('ec_perimeter_check',         'tasks', null, 'energy_community', 'study',           'community_manager', 'Perimeter and power checked against the limits of the country',
   'The members, their metering points and the production, against the distance and the power an operation may have (sharing_max_distance_m, sharing_max_power_kw).',
   '{"Map of the perimeter", "List of participants"}', null, 10),
  ('ec_legal_entity',            'tasks', null, 'energy_community', 'design',          'community_manager', 'Legal entity of the community founded, statutes signed',
   'The entity that organises the sharing, in a form the country allows; its statutes name the operation.',
   '{"Statutes", "Registration"}', 'ec_perimeter_check', 20),
  ('ec_allocation_key',          'tasks', null, 'energy_community', 'design',          'community_manager', 'Allocation key chosen and written in the members'' agreement',
   'How the shared energy is divided at each metering step, the internal price, and the rules of entry and exit.',
   '{"Members'' agreement"}', 'ec_legal_entity', 30),
  ('ec_member_consents',         'tasks', null, 'energy_community', 'permitting',      'community_manager', 'Members'' adhesions and consents to the use of their meter data collected',
   'Each member adheres to the operation and consents to the operator passing its metering data to the community.',
   '{"Adhesion forms", "Consents"}', 'ec_legal_entity', 40),
  ('ec_registration',            'tasks', null, 'energy_community', 'grid_connection', 'grid_operator',     'Sharing registered with the distribution operator',
   'The operator checks each metering point, records the key and starts allocating the shared energy.',
   '{"Agreement with the operator", "Activation notice"}', 'ec_allocation_key', 50),
  ('ec_settlement',              'tasks', null, 'energy_community', 'operation',       'community_manager', 'Periodic settlement of the shared energy',
   'At each settlement period (sharing_settlement_period), from the operator''s allocated curves: the energy shared to each member at the internal price, the producers'' share, the surplus sold.',
   '{"Settlement statement", "Invoices"}', 'ec_registration', 60);
