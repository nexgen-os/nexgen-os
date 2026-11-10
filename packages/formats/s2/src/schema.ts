// The messages of S2 (EN 50491-12-2) as the S2 JSON schemas describe them,
// version 1.0.0 (github.com/flexiblepower/s2-json): for each message and
// each object it carries, its fields and what each holds. Field names are
// kept as the schemas spell them, `supported_commodites` and the `Id` of a
// DDBC operation mode included.
//
// A field reads `<kind>` when required and `<kind>?` when optional. A kind is
// `id` (2 to 64 of `a-z A-Z 0-9 - _ :`), `date-time` (RFC 3339), `number`,
// `boolean`, `string`, `Duration` (whole milliseconds, 0 or more), `Currency`
// (an ISO 4217 code, which the schema lists and this library does not
// repeat: a currency is data of the place, never of the code), the name
// of an enumeration of `ENUMS`, the name of an object of `OBJECTS`, or
// `[<kind>]{min,max}`, a list of that kind and its bounds.

export const ENUMS = {
  'Commodity': ["GAS", "HEAT", "ELECTRICITY", "OIL"],
  'CommodityQuantity': ["ELECTRIC.POWER.L1", "ELECTRIC.POWER.L2", "ELECTRIC.POWER.L3", "ELECTRIC.POWER.3_PHASE_SYMMETRIC", "NATURAL_GAS.FLOW_RATE", "HYDROGEN.FLOW_RATE", "HEAT.TEMPERATURE", "HEAT.FLOW_RATE", "HEAT.THERMAL_POWER", "OIL.FLOW_RATE"],
  'ControlType': ["POWER_ENVELOPE_BASED_CONTROL", "POWER_PROFILE_BASED_CONTROL", "OPERATION_MODE_BASED_CONTROL", "FILL_RATE_BASED_CONTROL", "DEMAND_DRIVEN_BASED_CONTROL", "NOT_CONTROLABLE", "NO_SELECTION"],
  'EnergyManagementRole': ["CEM", "RM"],
  'InstructionStatus': ["NEW", "ACCEPTED", "REJECTED", "REVOKED", "STARTED", "SUCCEEDED", "ABORTED"],
  'PEBC.PowerEnvelopeConsequenceType': ["VANISH", "DEFER"],
  'PEBC.PowerEnvelopeLimitType': ["UPPER_LIMIT", "LOWER_LIMIT"],
  'PPBC.PowerSequenceStatus': ["NOT_SCHEDULED", "SCHEDULED", "EXECUTING", "INTERRUPTED", "FINISHED", "ABORTED"],
  'ReceptionStatusValues': ["INVALID_DATA", "INVALID_MESSAGE", "INVALID_CONTENT", "TEMPORARY_ERROR", "PERMANENT_ERROR", "OK"],
  'RevokableObjects': ["PEBC.PowerConstraints", "PEBC.EnergyConstraint", "PEBC.Instruction", "PPBC.PowerProfileDefinition", "PPBC.ScheduleInstruction", "PPBC.StartInterruptionInstruction", "PPBC.EndInterruptionInstruction", "OMBC.SystemDescription", "OMBC.Instruction", "FRBC.SystemDescription", "FRBC.Instruction", "DDBC.SystemDescription", "DDBC.Instruction"],
  'RoleType': ["ENERGY_PRODUCER", "ENERGY_CONSUMER", "ENERGY_STORAGE"],
  'SessionRequestType': ["RECONNECT", "TERMINATE"],
} as const satisfies Record<string, readonly string[]>;

export const OBJECTS: Record<string, Record<string, string>> = {
  'DDBC.ActuatorDescription': { id: 'id', diagnostic_label: 'string?', supported_commodites: '[Commodity]{1,4}', operation_modes: '[DDBC.OperationMode]{1,100}', transitions: '[Transition]{0,1000}', timers: '[Timer]{0,1000}' },
  'DDBC.AverageDemandRateForecastElement': { duration: 'Duration', demand_rate_upper_limit: 'number?', demand_rate_upper_95PPR: 'number?', demand_rate_upper_68PPR: 'number?', demand_rate_expected: 'number', demand_rate_lower_68PPR: 'number?', demand_rate_lower_95PPR: 'number?', demand_rate_lower_limit: 'number?' },
  'DDBC.OperationMode': { Id: 'id', diagnostic_label: 'string?', power_ranges: '[PowerRange]{1,10}', supply_range: 'NumberRange', running_costs: 'NumberRange?', abnormal_condition_only: 'boolean' },
  'FRBC.ActuatorDescription': { id: 'id', diagnostic_label: 'string?', supported_commodities: '[Commodity]{1,4}', operation_modes: '[FRBC.OperationMode]{1,100}', transitions: '[Transition]{0,1000}', timers: '[Timer]{0,1000}' },
  'FRBC.FillLevelTargetProfileElement': { duration: 'Duration', fill_level_range: 'NumberRange' },
  'FRBC.LeakageBehaviourElement': { fill_level_range: 'NumberRange', leakage_rate: 'number' },
  'FRBC.OperationMode': { id: 'id', diagnostic_label: 'string?', elements: '[FRBC.OperationModeElement]{1,100}', abnormal_condition_only: 'boolean' },
  'FRBC.OperationModeElement': { fill_level_range: 'NumberRange', fill_rate: 'NumberRange', power_ranges: '[PowerRange]{1,10}', running_costs: 'NumberRange?' },
  'FRBC.StorageDescription': { diagnostic_label: 'string?', fill_level_label: 'string?', provides_leakage_behaviour: 'boolean', provides_fill_level_target_profile: 'boolean', provides_usage_forecast: 'boolean', fill_level_range: 'NumberRange' },
  'FRBC.UsageForecastElement': { duration: 'Duration', usage_rate_upper_limit: 'number?', usage_rate_upper_95PPR: 'number?', usage_rate_upper_68PPR: 'number?', usage_rate_expected: 'number', usage_rate_lower_68PPR: 'number?', usage_rate_lower_95PPR: 'number?', usage_rate_lower_limit: 'number?' },
  'NumberRange': { start_of_range: 'number', end_of_range: 'number' },
  'OMBC.OperationMode': { id: 'id', diagnostic_label: 'string?', power_ranges: '[PowerRange]{1,10}', running_costs: 'NumberRange?', abnormal_condition_only: 'boolean' },
  'PEBC.AllowedLimitRange': { commodity_quantity: 'CommodityQuantity', limit_type: 'PEBC.PowerEnvelopeLimitType', range_boundary: 'NumberRange', abnormal_condition_only: 'boolean' },
  'PEBC.PowerEnvelope': { id: 'id', commodity_quantity: 'CommodityQuantity', power_envelope_elements: '[PEBC.PowerEnvelopeElement]{1,288}' },
  'PEBC.PowerEnvelopeElement': { duration: 'Duration', upper_limit: 'number', lower_limit: 'number' },
  'PPBC.PowerSequence': { id: 'id', elements: '[PPBC.PowerSequenceElement]{1,288}', is_interruptible: 'boolean', max_pause_before: 'Duration?', abnormal_condition_only: 'boolean' },
  'PPBC.PowerSequenceContainer': { id: 'id', power_sequences: '[PPBC.PowerSequence]{1,288}' },
  'PPBC.PowerSequenceContainerStatus': { power_profile_id: 'id', sequence_container_id: 'id', selected_sequence_id: 'id?', progress: 'Duration?', status: 'PPBC.PowerSequenceStatus' },
  'PPBC.PowerSequenceElement': { duration: 'Duration', power_values: '[PowerForecastValue]{1,10}' },
  'PowerForecastElement': { duration: 'Duration', power_values: '[PowerForecastValue]{1,10}' },
  'PowerForecastValue': { value_upper_limit: 'number?', value_upper_95PPR: 'number?', value_upper_68PPR: 'number?', value_expected: 'number', value_lower_68PPR: 'number?', value_lower_95PPR: 'number?', value_lower_limit: 'number?', commodity_quantity: 'CommodityQuantity' },
  'PowerRange': { start_of_range: 'number', end_of_range: 'number', commodity_quantity: 'CommodityQuantity' },
  'PowerValue': { commodity_quantity: 'CommodityQuantity', value: 'number' },
  'Role': { role: 'RoleType', commodity: 'Commodity' },
  'Timer': { id: 'id', diagnostic_label: 'string?', duration: 'Duration' },
  'Transition': { id: 'id', from: 'id', to: 'id', start_timers: '[id]{0,1000}', blocking_timers: '[id]{0,1000}', transition_costs: 'number?', transition_duration: 'Duration?', abnormal_condition_only: 'boolean' },
};

export const MESSAGES: Record<string, Record<string, string>> = {
  'DDBC.ActuatorStatus': { message_id: 'id', actuator_id: 'id', active_operation_mode_id: 'id', operation_mode_factor: 'number', previous_operation_mode_id: 'id?', transition_timestamp: 'date-time?' },
  'DDBC.AverageDemandRateForecast': { message_id: 'id', start_time: 'date-time', elements: '[DDBC.AverageDemandRateForecastElement]{1,288}' },
  'DDBC.Instruction': { message_id: 'id', id: 'id', execution_time: 'date-time', abnormal_condition: 'boolean', actuator_id: 'id', operation_mode_id: 'id', operation_mode_factor: 'number' },
  'DDBC.PresentDemandStatus': { message_id: 'id', present_demand_rate: 'NumberRange' },
  'DDBC.SystemDescription': { message_id: 'id', valid_from: 'date-time', actuators: '[DDBC.ActuatorDescription]{1,10}', provides_average_demand_rate_forecast: 'boolean' },
  'DDBC.TimerStatus': { message_id: 'id', timer_id: 'id', actuator_id: 'id', finished_at: 'date-time' },
  'FRBC.ActuatorStatus': { message_id: 'id', actuator_id: 'id', active_operation_mode_id: 'id', operation_mode_factor: 'number', previous_operation_mode_id: 'id?', transition_timestamp: 'date-time?' },
  'FRBC.FillLevelTargetProfile': { message_id: 'id', start_time: 'date-time', elements: '[FRBC.FillLevelTargetProfileElement]{1,288}' },
  'FRBC.Instruction': { message_id: 'id', id: 'id', actuator_id: 'id', operation_mode: 'id', operation_mode_factor: 'number', execution_time: 'date-time', abnormal_condition: 'boolean' },
  'FRBC.LeakageBehaviour': { message_id: 'id', valid_from: 'date-time', elements: '[FRBC.LeakageBehaviourElement]{1,288}' },
  'FRBC.StorageStatus': { message_id: 'id', present_fill_level: 'number' },
  'FRBC.SystemDescription': { message_id: 'id', valid_from: 'date-time', actuators: '[FRBC.ActuatorDescription]{1,10}', storage: 'FRBC.StorageDescription' },
  'FRBC.TimerStatus': { message_id: 'id', timer_id: 'id', actuator_id: 'id', finished_at: 'date-time' },
  'FRBC.UsageForecast': { message_id: 'id', start_time: 'date-time', elements: '[FRBC.UsageForecastElement]{1,288}' },
  'Handshake': { message_id: 'id', role: 'EnergyManagementRole', supported_protocol_versions: '[string]{1,}?' },
  'HandshakeResponse': { message_id: 'id', selected_protocol_version: 'string' },
  'InstructionStatusUpdate': { message_id: 'id', instruction_id: 'id', status_type: 'InstructionStatus', timestamp: 'date-time' },
  'OMBC.Instruction': { message_id: 'id', id: 'id', execution_time: 'date-time', operation_mode_id: 'id', operation_mode_factor: 'number', abnormal_condition: 'boolean' },
  'OMBC.Status': { message_id: 'id', active_operation_mode_id: 'id', operation_mode_factor: 'number', previous_operation_mode_id: 'id?', transition_timestamp: 'date-time?' },
  'OMBC.SystemDescription': { message_id: 'id', valid_from: 'date-time', operation_modes: '[OMBC.OperationMode]{1,100}', transitions: '[Transition]{0,1000}', timers: '[Timer]{0,1000}' },
  'OMBC.TimerStatus': { message_id: 'id', timer_id: 'id', finished_at: 'date-time' },
  'PEBC.EnergyConstraint': { message_id: 'id', id: 'id', valid_from: 'date-time', valid_until: 'date-time', upper_average_power: 'number', lower_average_power: 'number', commodity_quantity: 'CommodityQuantity' },
  'PEBC.Instruction': { message_id: 'id', id: 'id', execution_time: 'date-time', abnormal_condition: 'boolean', power_constraints_id: 'id', power_envelopes: '[PEBC.PowerEnvelope]{1,10}' },
  'PEBC.PowerConstraints': { message_id: 'id', id: 'id', valid_from: 'date-time', valid_until: 'date-time?', consequence_type: 'PEBC.PowerEnvelopeConsequenceType', allowed_limit_ranges: '[PEBC.AllowedLimitRange]{2,100}' },
  'PPBC.EndInterruptionInstruction': { message_id: 'id', id: 'id', power_profile_id: 'id', sequence_container_id: 'id', power_sequence_id: 'id', execution_time: 'date-time', abnormal_condition: 'boolean' },
  'PPBC.PowerProfileDefinition': { message_id: 'id', id: 'id', start_time: 'date-time', end_time: 'date-time', power_sequences_containers: '[PPBC.PowerSequenceContainer]{1,1000}' },
  'PPBC.PowerProfileStatus': { message_id: 'id', sequence_container_status: '[PPBC.PowerSequenceContainerStatus]{1,1000}' },
  'PPBC.ScheduleInstruction': { message_id: 'id', id: 'id', power_profile_id: 'id', sequence_container_id: 'id', power_sequence_id: 'id', execution_time: 'date-time', abnormal_condition: 'boolean' },
  'PPBC.StartInterruptionInstruction': { message_id: 'id', id: 'id', power_profile_id: 'id', sequence_container_id: 'id', power_sequence_id: 'id', execution_time: 'date-time', abnormal_condition: 'boolean' },
  'PowerForecast': { message_id: 'id', start_time: 'date-time', elements: '[PowerForecastElement]{1,288}' },
  'PowerMeasurement': { message_id: 'id', measurement_timestamp: 'date-time', values: '[PowerValue]{1,10}' },
  'ReceptionStatus': { subject_message_id: 'id', status: 'ReceptionStatusValues', diagnostic_label: 'string?' },
  'ResourceManagerDetails': { message_id: 'id', resource_id: 'id', name: 'string?', roles: '[Role]{1,3}', manufacturer: 'string?', model: 'string?', serial_number: 'string?', firmware_version: 'string?', instruction_processing_delay: 'Duration', available_control_types: '[ControlType]{1,5}', currency: 'Currency?', provides_forecast: 'boolean', provides_power_measurement_types: '[CommodityQuantity]{1,10}' },
  'RevokeObject': { message_id: 'id', object_type: 'RevokableObjects', object_id: 'id' },
  'SelectControlType': { message_id: 'id', control_type: 'ControlType' },
  'SessionRequest': { message_id: 'id', request: 'SessionRequestType', diagnostic_label: 'string?' },
};
