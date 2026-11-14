export type SpecificationFieldType = "text" | "number" | "select" | "custom_select" | "multi_select" | "boolean" | "measurement";

export type SpecificationField = {
  key: string;
  label: string;
  type: SpecificationFieldType;
  options?: string[];
  unit?: string;
  units?: string[];
  required?: boolean;
  allowCustom?: boolean;
  customerVisible?: boolean;
  filterable?: boolean;
  variationRelated?: boolean;
};

export type SpecificationTemplateMap = Record<string, SpecificationField[]>;
export type SpecificationValue = string | number | boolean | string[] | { value: number; unit: string };

type Family =
  | "smartphone" | "tablet" | "mobile_accessory" | "phone_case" | "charger" | "power_bank"
  | "laptop" | "desktop" | "display" | "keyboard" | "mouse" | "storage" | "computer_accessory" | "laptop_bag" | "networking"
  | "console" | "platform_accessory" | "controller" | "headset" | "gaming_keyboard" | "gaming_chair" | "gaming_monitor" | "gaming_accessory"
  | "audio" | "speaker" | "smartwatch" | "camera" | "smart_home" | "television" | "electronic_accessory" | "projector"
  | "kitchen_appliance" | "refrigerator" | "washing_machine" | "air_conditioner" | "fan" | "vacuum" | "iron" | "blender" | "microwave" | "household_appliance"
  | "clothing" | "shoe" | "bag" | "fashion_watch" | "jewellery" | "fashion_accessory" | "sportswear" | "fashion_sportswear"
  | "skincare" | "cleanser" | "moisturiser" | "serum" | "sunscreen" | "makeup" | "haircare" | "beauty_tool" | "personal_care"
  | "figure" | "anime_clothing" | "anime_accessory" | "plush" | "poster" | "collectible" | "cosplay" | "anime_merch"
  | "school_bag" | "backpack" | "notebook" | "stationery" | "writing_tool" | "calculator" | "office_accessory" | "study_equipment"
  | "fitness_equipment" | "training_accessory" | "outdoor_equipment" | "exercise_accessory"
  | "toy" | "educational_toy" | "baby_accessory" | "children_clothing" | "game" | "kids_product"
  | "furniture" | "home_decoration" | "lighting" | "bedding" | "storage_organisation" | "kitchenware" | "bathroom_accessory"
  | "car_accessory" | "car_electronics" | "interior_accessory" | "exterior_accessory" | "car_cleaning"
  | "travel_bag" | "luggage" | "travel_accessory" | "everyday_carry" | "lifestyle";

const field = (
  key: string,
  label: string,
  type: SpecificationFieldType = "text",
  extras: Partial<Omit<SpecificationField, "key" | "label" | "type">> = {},
): SpecificationField => ({ customerVisible: true, ...extras, key, label, type });

const size = field("available_sizes", "Available sizes", "multi_select", { options: ["XS", "S", "M", "L", "XL", "XXL"], allowCustom: true, variationRelated: true, filterable: true });
const colours = field("available_colours", "Available colours", "multi_select", { options: ["Black", "White", "Blue", "Red", "Green", "Grey", "Silver", "Gold"], allowCustom: true, variationRelated: true, filterable: true });
const brand = field("brand", "Brand");
const material = field("material", "Material");
const model = field("model", "Model");
const dimensions = field("dimensions", "Dimensions", "measurement", { units: ["mm", "cm", "m", "in"], allowCustom: true });
const weight = field("weight", "Weight", "measurement", { units: ["g", "kg", "oz", "lb"] });
const voltage = field("voltage", "Voltage", "measurement", { units: ["V", "mV"] });

const families: Record<Family, SpecificationField[]> = {
  smartphone: [brand, model, field("ram", "RAM", "measurement", { units: ["GB"] }), field("storage", "Storage", "measurement", { units: ["GB", "TB"], variationRelated: true }), field("screen_size", "Screen size", "measurement", { units: ["in"] }), field("screen_resolution", "Screen resolution"), field("processor", "Processor"), field("battery_capacity", "Battery capacity", "measurement", { units: ["mAh"] }), field("camera_specifications", "Camera specifications"), field("operating_system", "Operating system"), field("network_support", "Network support"), field("sim_configuration", "SIM configuration"), colours],
  tablet: [brand, model, field("screen_size", "Screen size", "measurement", { units: ["in"] }), field("screen_resolution", "Screen resolution"), field("processor", "Processor"), field("ram", "RAM", "measurement", { units: ["GB"] }), field("storage", "Storage", "measurement", { units: ["GB", "TB"], variationRelated: true }), field("battery_capacity", "Battery capacity", "measurement", { units: ["mAh"] }), field("operating_system", "Operating system"), field("network_support", "Network support"), colours],
  mobile_accessory: [brand, field("accessory_type", "Accessory type"), field("compatible_devices", "Compatible devices", "multi_select", { allowCustom: true, filterable: true }), material, colours],
  phone_case: [brand, field("case_type", "Case type"), field("compatible_model", "Compatible model", "multi_select", { allowCustom: true, variationRelated: true, filterable: true }), material, field("protection_features", "Protection features", "multi_select", { allowCustom: true }), colours],
  charger: [brand, field("charger_type", "Charger type"), field("output_power", "Output power", "measurement", { units: ["W"] }), field("output_voltage", "Output voltage", "measurement", { units: ["V"] }), field("connector_type", "Connector type", "multi_select", { options: ["USB-C", "USB-A", "Lightning", "Micro-USB"], allowCustom: true }), field("fast_charging", "Fast charging", "boolean"), voltage],
  power_bank: [brand, model, field("capacity", "Capacity", "measurement", { units: ["mAh", "Wh"] }), field("output_ports", "Output ports", "multi_select", { options: ["USB-A", "USB-C", "Micro-USB"], allowCustom: true }), field("max_output", "Maximum output", "measurement", { units: ["W"] }), field("fast_charging", "Fast charging", "boolean"), weight, colours],
  laptop: [brand, model, field("processor", "Processor"), field("ram", "RAM", "measurement", { units: ["GB"] }), field("storage", "Storage", "measurement", { units: ["GB", "TB"] }), field("gpu", "GPU"), field("screen_size", "Screen size", "measurement", { units: ["in"] }), field("resolution", "Resolution"), field("operating_system", "Operating system"), field("battery", "Battery"), colours],
  desktop: [brand, model, field("processor", "Processor"), field("ram", "RAM", "measurement", { units: ["GB"] }), field("storage", "Storage", "measurement", { units: ["GB", "TB"] }), field("gpu", "GPU"), field("operating_system", "Operating system"), field("form_factor", "Form factor"), field("connectivity", "Connectivity")],
  display: [brand, model, field("screen_size", "Screen size", "measurement", { units: ["in"] }), field("resolution", "Resolution"), field("display_technology", "Display technology"), field("refresh_rate", "Refresh rate", "measurement", { units: ["Hz"] }), field("response_time", "Response time", "measurement", { units: ["ms"] }), field("ports", "Ports", "multi_select", { allowCustom: true }), field("connectivity", "Connectivity")],
  keyboard: [brand, model, field("layout", "Layout", "custom_select", { options: ["US", "UK", "International"], allowCustom: true }), field("keyboard_type", "Keyboard type", "custom_select", { options: ["Membrane", "Mechanical", "Scissor"], allowCustom: true }), field("switch_type", "Switch type"), field("connectivity", "Connectivity", "multi_select", { options: ["USB", "Bluetooth", "2.4 GHz"], allowCustom: true }), field("backlight", "Backlight", "boolean"), colours],
  mouse: [brand, model, field("sensor_type", "Sensor type"), field("dpi", "DPI", "number", { unit: "DPI" }), field("buttons", "Buttons", "number"), field("connectivity", "Connectivity", "multi_select", { options: ["USB", "Bluetooth", "2.4 GHz"], allowCustom: true }), field("handedness", "Handedness", "custom_select", { options: ["Ambidextrous", "Right-handed", "Left-handed"], allowCustom: true }), colours],
  storage: [brand, model, field("storage_capacity", "Storage capacity", "measurement", { units: ["GB", "TB"] }), field("storage_type", "Storage type", "custom_select", { options: ["SSD", "HDD", "USB flash", "Memory card"], allowCustom: true }), field("interface", "Interface"), field("read_speed", "Read speed", "measurement", { units: ["MB/s", "GB/s"] }), field("write_speed", "Write speed", "measurement", { units: ["MB/s", "GB/s"] }), weight],
  computer_accessory: [brand, field("accessory_type", "Accessory type"), field("compatible_devices", "Compatible devices", "multi_select", { allowCustom: true }), field("interface", "Interface"), material, dimensions],
  laptop_bag: [brand, field("bag_type", "Bag type"), field("compatible_screen_size", "Compatible laptop size", "measurement", { units: ["in"] }), material, field("compartments", "Compartments", "number"), field("water_resistant", "Water resistant", "boolean"), colours],
  networking: [brand, model, field("device_type", "Device type"), field("wireless_standard", "Wireless standard"), field("data_rate", "Data rate", "measurement", { units: ["Mbps", "Gbps"] }), field("frequency_bands", "Frequency bands", "multi_select", { allowCustom: true }), field("ports", "Ports", "number"), field("security", "Security"), voltage],
  console: [brand, model, field("platform", "Platform", "custom_select", { options: ["PlayStation", "Xbox", "Nintendo", "PC"], allowCustom: true, filterable: true }), field("storage", "Storage", "measurement", { units: ["GB", "TB"] }), field("resolution", "Resolution"), field("connectivity", "Connectivity", "multi_select", { allowCustom: true }), field("included_items", "Included items", "multi_select", { allowCustom: true }), colours],
  platform_accessory: [brand, field("platform_compatibility", "Platform compatibility", "multi_select", { allowCustom: true, filterable: true }), field("accessory_type", "Accessory type"), field("connection", "Connection type"), material, colours],
  controller: [brand, model, field("platform_compatibility", "Platform compatibility", "multi_select", { allowCustom: true, filterable: true }), field("connection", "Connection type", "multi_select", { options: ["Wired", "Bluetooth", "2.4 GHz"], allowCustom: true }), field("battery", "Battery"), field("vibration", "Vibration feedback", "boolean"), colours],
  headset: [brand, model, field("headphone_type", "Headphone type", "custom_select", { options: ["Over-ear", "On-ear", "In-ear"], allowCustom: true }), field("connectivity", "Connectivity", "multi_select", { options: ["Wired", "Bluetooth", "2.4 GHz"], allowCustom: true }), field("microphone", "Microphone", "boolean"), field("frequency_response", "Frequency response"), field("compatibility", "Compatibility", "multi_select", { allowCustom: true }), colours],
  gaming_keyboard: [brand, model, field("keyboard_type", "Keyboard type", "custom_select", { options: ["Mechanical", "Membrane"], allowCustom: true }), field("switch_type", "Switch type"), field("layout", "Layout"), field("connectivity", "Connectivity", "multi_select", { allowCustom: true }), field("backlight", "Backlight", "boolean"), field("platform_compatibility", "Platform compatibility", "multi_select", { allowCustom: true })],
  gaming_chair: [brand, model, material, field("max_supported_weight", "Maximum supported weight", "measurement", { units: ["kg", "lb"] }), field("reclining", "Reclining", "boolean"), field("adjustable_features", "Adjustable features", "multi_select", { allowCustom: true }), colours],
  gaming_monitor: [brand, model, field("screen_size", "Screen size", "measurement", { units: ["in"] }), field("resolution", "Resolution"), field("refresh_rate", "Refresh rate", "measurement", { units: ["Hz"] }), field("response_time", "Response time", "measurement", { units: ["ms"] }), field("display_technology", "Display technology"), field("ports", "Ports", "multi_select", { allowCustom: true })],
  gaming_accessory: [brand, field("accessory_type", "Accessory type"), field("platform_compatibility", "Platform compatibility", "multi_select", { allowCustom: true }), field("connectivity", "Connectivity"), material, colours],
  audio: [brand, model, field("audio_type", "Audio type"), field("connectivity", "Connectivity", "multi_select", { allowCustom: true }), field("frequency_response", "Frequency response"), field("microphone", "Microphone", "boolean"), field("noise_cancellation", "Noise cancellation", "boolean"), colours],
  speaker: [brand, model, field("speaker_type", "Speaker type"), field("output_power", "Output power", "measurement", { units: ["W"] }), field("connectivity", "Connectivity", "multi_select", { allowCustom: true }), field("water_resistance", "Water resistance", "custom_select", { options: ["None", "IPX4", "IPX5", "IPX7"], allowCustom: true }), field("battery_life", "Battery life", "measurement", { units: ["h"] }), colours],
  smartwatch: [brand, model, field("display_size", "Display size", "measurement", { units: ["in"] }), field("compatibility", "Phone compatibility", "multi_select", { allowCustom: true }), field("battery_life", "Battery life", "measurement", { units: ["h", "days"] }), field("water_resistance", "Water resistance", "custom_select", { options: ["None", "IPX4", "IP67", "IP68"], allowCustom: true }), field("health_sensors", "Health sensors", "multi_select", { allowCustom: true }), colours],
  camera: [brand, model, field("camera_type", "Camera type"), field("sensor_resolution", "Sensor resolution", "measurement", { units: ["MP"] }), field("video_resolution", "Video resolution"), field("lens_mount", "Lens mount"), field("connectivity", "Connectivity", "multi_select", { allowCustom: true }), weight],
  smart_home: [brand, model, field("device_type", "Device type"), field("connectivity", "Connectivity", "multi_select", { allowCustom: true }), field("compatible_platforms", "Compatible platforms", "multi_select", { allowCustom: true }), field("power_source", "Power source"), field("voice_control", "Voice control", "boolean")],
  television: [brand, model, field("screen_size", "Screen size", "measurement", { units: ["in"] }), field("resolution", "Resolution"), field("display_technology", "Display technology"), field("refresh_rate", "Refresh rate", "measurement", { units: ["Hz"] }), field("operating_system", "Operating system"), field("hdmi_ports", "HDMI ports", "number"), field("usb_ports", "USB ports", "number"), field("connectivity", "Connectivity", "multi_select", { allowCustom: true })],
  electronic_accessory: [brand, field("accessory_type", "Accessory type"), field("compatible_devices", "Compatible devices", "multi_select", { allowCustom: true }), field("connector_type", "Connector type"), material, colours],
  projector: [brand, model, field("projection_technology", "Projection technology"), field("resolution", "Resolution"), field("brightness", "Brightness", "measurement", { units: ["lumens"] }), field("throw_ratio", "Throw ratio"), field("connectivity", "Connectivity", "multi_select", { allowCustom: true }), dimensions],
  kitchen_appliance: [brand, model, field("appliance_type", "Appliance type"), field("capacity", "Capacity", "measurement", { units: ["L", "ml", "kg"] }), field("power", "Power", "measurement", { units: ["W", "kW"] }), field("functions", "Functions", "multi_select", { allowCustom: true }), field("voltage", "Voltage", "measurement", { units: ["V"] }), colours],
  refrigerator: [brand, model, field("capacity", "Capacity", "measurement", { units: ["L"] }), dimensions, field("number_of_doors", "Number of doors", "number"), field("cooling_technology", "Cooling technology"), field("energy_rating", "Energy rating"), field("defrost_type", "Defrost type"), colours],
  washing_machine: [brand, model, field("capacity", "Capacity", "measurement", { units: ["kg"] }), field("load_type", "Load type", "custom_select", { options: ["Front load", "Top load"], allowCustom: true }), field("spin_speed", "Spin speed", "measurement", { units: ["rpm"] }), field("wash_programs", "Wash programmes", "multi_select", { allowCustom: true }), field("energy_rating", "Energy rating"), dimensions],
  air_conditioner: [brand, model, field("cooling_capacity", "Cooling capacity", "measurement", { units: ["BTU/h", "kW"] }), field("room_size", "Recommended room size", "measurement", { units: ["m²", "ft²"] }), field("energy_rating", "Energy rating"), field("inverter", "Inverter", "boolean"), field("refrigerant", "Refrigerant"), voltage],
  fan: [brand, model, field("fan_type", "Fan type"), field("number_of_speeds", "Number of speeds", "number"), field("diameter", "Diameter", "measurement", { units: ["cm", "in"] }), field("oscillation", "Oscillation", "boolean"), field("power", "Power", "measurement", { units: ["W"] }), colours],
  vacuum: [brand, model, field("vacuum_type", "Vacuum type"), field("power", "Power", "measurement", { units: ["W"] }), field("dust_capacity", "Dust capacity", "measurement", { units: ["L"] }), field("cordless", "Cordless", "boolean"), field("filter_type", "Filter type"), weight],
  iron: [brand, model, field("iron_type", "Iron type"), field("power", "Power", "measurement", { units: ["W"] }), field("steam", "Steam function", "boolean"), field("water_tank_capacity", "Water tank capacity", "measurement", { units: ["ml"] }), field("soleplate_material", "Soleplate material"), voltage],
  blender: [brand, model, field("capacity", "Capacity", "measurement", { units: ["L", "ml"] }), field("power", "Power", "measurement", { units: ["W"] }), field("speed_settings", "Speed settings", "number"), field("blade_material", "Blade material"), field("functions", "Functions", "multi_select", { allowCustom: true })],
  microwave: [brand, model, field("capacity", "Capacity", "measurement", { units: ["L"] }), field("power", "Power", "measurement", { units: ["W"] }), field("microwave_type", "Microwave type"), field("cooking_functions", "Cooking functions", "multi_select", { allowCustom: true }), dimensions, colours],
  household_appliance: [brand, model, field("appliance_type", "Appliance type"), field("power", "Power", "measurement", { units: ["W"] }), field("capacity", "Capacity", "measurement", { units: ["L", "kg"] }), field("functions", "Functions", "multi_select", { allowCustom: true }), voltage, colours],
  clothing: [brand, field("clothing_type", "Clothing type"), material, size, colours, field("fit", "Fit"), field("care_instructions", "Care instructions"), field("gender", "Gender", "custom_select", { options: ["Men", "Women", "Unisex"], allowCustom: true })],
  shoe: [brand, field("shoe_type", "Shoe type"), field("upper_material", "Upper material"), field("sole_material", "Sole material"), field("available_sizes", "Available sizes", "multi_select", { options: ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45"], allowCustom: true, variationRelated: true, filterable: true }), colours, field("closure", "Closure"), field("gender", "Gender", "custom_select", { options: ["Men", "Women", "Unisex"], allowCustom: true })],
  bag: [brand, field("bag_type", "Bag type"), material, field("capacity", "Capacity", "measurement", { units: ["L"] }), dimensions, field("compartments", "Compartments", "number"), field("closure", "Closure"), colours],
  fashion_watch: [brand, model, field("movement", "Movement"), field("display_type", "Display type"), field("case_material", "Case material"), field("band_material", "Band material"), field("water_resistance", "Water resistance"), field("band_length", "Band length", "measurement", { units: ["mm", "cm"] }), colours],
  jewellery: [brand, field("jewellery_type", "Jewellery type"), field("material", "Material"), field("gemstone", "Gemstone"), field("finish", "Finish"), field("size", "Size", "custom_select", { allowCustom: true, variationRelated: true }), colours],
  fashion_accessory: [brand, field("accessory_type", "Accessory type"), material, field("gender", "Gender", "custom_select", { options: ["Men", "Women", "Unisex"], allowCustom: true }), size, colours],
  sportswear: [brand, field("garment_type", "Garment type"), material, size, colours, field("gender", "Gender", "custom_select", { options: ["Men", "Women", "Unisex"], allowCustom: true }), field("activity", "Intended activity", "multi_select", { allowCustom: true })],
  fashion_sportswear: [brand, field("garment_type", "Garment type"), material, size, colours, field("fit", "Fit"), field("gender", "Gender", "custom_select", { options: ["Men", "Women", "Unisex"], allowCustom: true })],
  skincare: [brand, field("skin_type", "Skin type", "multi_select", { options: ["All", "Dry", "Oily", "Combination", "Sensitive"], allowCustom: true }), field("key_ingredients", "Key ingredients", "multi_select", { allowCustom: true }), field("volume", "Net volume", "measurement", { units: ["ml", "L", "g"] }), field("spf", "SPF", "number"), field("fragrance_free", "Fragrance free", "boolean"), field("expiry", "Expiry / shelf life")],
  cleanser: [brand, field("skin_type", "Skin type", "multi_select", { options: ["All", "Dry", "Oily", "Combination", "Sensitive"], allowCustom: true }), field("cleanser_type", "Cleanser type"), field("key_ingredients", "Key ingredients", "multi_select", { allowCustom: true }), field("volume", "Net volume", "measurement", { units: ["ml", "L", "g"] }), field("fragrance_free", "Fragrance free", "boolean"), field("expiry", "Expiry / shelf life")],
  moisturiser: [brand, field("skin_type", "Skin type", "multi_select", { options: ["All", "Dry", "Oily", "Combination", "Sensitive"], allowCustom: true }), field("moisturiser_type", "Moisturiser type"), field("key_ingredients", "Key ingredients", "multi_select", { allowCustom: true }), field("volume", "Net volume", "measurement", { units: ["ml", "L", "g"] }), field("fragrance_free", "Fragrance free", "boolean"), field("expiry", "Expiry / shelf life")],
  serum: [brand, field("skin_type", "Skin type", "multi_select", { options: ["All", "Dry", "Oily", "Combination", "Sensitive"], allowCustom: true }), field("active_ingredients", "Active ingredients", "multi_select", { allowCustom: true }), field("concentration", "Concentration"), field("volume", "Net volume", "measurement", { units: ["ml", "g"] }), field("fragrance_free", "Fragrance free", "boolean"), field("expiry", "Expiry / shelf life")],
  sunscreen: [brand, field("spf", "SPF", "number"), field("protection_type", "Protection type", "multi_select", { options: ["UVA", "UVB", "Broad spectrum"], allowCustom: true }), field("skin_type", "Skin type", "multi_select", { allowCustom: true }), field("volume", "Net volume", "measurement", { units: ["ml", "g"] }), field("water_resistant", "Water resistant", "boolean"), field("expiry", "Expiry / shelf life")],
  makeup: [brand, field("makeup_type", "Makeup type"), field("finish", "Finish"), field("coverage", "Coverage"), field("shade", "Shade", "multi_select", { allowCustom: true, variationRelated: true }), field("skin_type", "Skin type", "multi_select", { allowCustom: true }), field("net_weight", "Net weight", "measurement", { units: ["g", "ml"] }), field("expiry", "Expiry / shelf life")],
  haircare: [brand, field("hair_type", "Hair type", "multi_select", { allowCustom: true }), field("haircare_type", "Product type"), field("key_ingredients", "Key ingredients", "multi_select", { allowCustom: true }), field("volume", "Net volume", "measurement", { units: ["ml", "L", "g"] }), field("sulfate_free", "Sulfate free", "boolean"), field("expiry", "Expiry / shelf life")],
  beauty_tool: [brand, field("tool_type", "Tool type"), field("power_source", "Power source"), field("settings", "Settings", "multi_select", { allowCustom: true }), field("material", "Material"), voltage, colours],
  personal_care: [brand, field("product_type", "Product type"), field("skin_or_hair_type", "Suitable for"), field("key_ingredients", "Key ingredients", "multi_select", { allowCustom: true }), field("volume_or_weight", "Net volume / weight", "measurement", { units: ["ml", "g"] }), field("expiry", "Expiry / shelf life")],
  figure: [brand, field("series", "Series / franchise"), field("character", "Character"), field("material", "Material"), field("height", "Height", "measurement", { units: ["cm", "mm", "in"] }), field("scale", "Scale"), field("age_recommendation", "Age recommendation"), field("included_accessories", "Included accessories", "multi_select", { allowCustom: true })],
  anime_clothing: [brand, field("series", "Series / franchise"), field("garment_type", "Garment type"), material, size, colours, field("character_or_design", "Character / design")],
  anime_accessory: [brand, field("series", "Series / franchise"), field("accessory_type", "Accessory type"), material, field("character_or_design", "Character / design"), colours],
  plush: [brand, field("series", "Series / franchise"), field("character", "Character"), field("material", "Material"), field("height", "Height", "measurement", { units: ["cm", "mm", "in"] }), field("age_recommendation", "Age recommendation"), field("care_instructions", "Care instructions")],
  poster: [brand, field("series", "Series / franchise"), field("artwork", "Artwork / character"), field("width", "Width", "measurement", { units: ["cm", "mm", "in"] }), field("height", "Height", "measurement", { units: ["cm", "mm", "in"] }), field("print_material", "Print material"), field("framed", "Framed", "boolean")],
  collectible: [brand, field("series", "Series / franchise"), field("item_type", "Collectible type"), field("material", "Material"), field("edition", "Edition / release"), field("dimensions", "Dimensions", "measurement", { units: ["cm", "mm", "in"] }), field("age_recommendation", "Age recommendation")],
  cosplay: [brand, field("series", "Series / franchise"), field("character", "Character"), field("costume_type", "Costume type"), material, size, field("included_accessories", "Included accessories", "multi_select", { allowCustom: true }), colours],
  anime_merch: [brand, field("series", "Series / franchise"), field("item_type", "Merchandise type"), field("character_or_design", "Character / design"), material, size, colours],
  school_bag: [brand, field("bag_type", "Bag type"), material, field("capacity", "Capacity", "measurement", { units: ["L"] }), dimensions, field("compartments", "Compartments", "number"), field("water_resistant", "Water resistant", "boolean"), colours],
  backpack: [brand, field("backpack_type", "Backpack type"), material, field("capacity", "Capacity", "measurement", { units: ["L"] }), dimensions, field("compartments", "Compartments", "number"), field("laptop_compartment", "Laptop compartment", "boolean"), colours],
  notebook: [brand, field("page_count", "Page count", "number"), field("paper_size", "Paper size", "custom_select", { options: ["A4", "A5", "A6", "Letter"], allowCustom: true }), field("ruling", "Ruling", "custom_select", { options: ["Ruled", "Plain", "Grid", "Dotted"], allowCustom: true }), field("cover_type", "Cover type"), field("binding", "Binding"), colours],
  stationery: [brand, field("stationery_type", "Stationery type"), material, field("pack_quantity", "Pack quantity", "number"), field("colour", "Colour", "multi_select", { allowCustom: true }), field("compatible_use", "Suitable use", "multi_select", { allowCustom: true })],
  writing_tool: [brand, field("writing_tool_type", "Writing tool type"), field("ink_type", "Ink type"), field("tip_size", "Tip size", "measurement", { units: ["mm"] }), field("refillable", "Refillable", "boolean"), field("pack_quantity", "Pack quantity", "number"), colours],
  calculator: [brand, model, field("calculator_type", "Calculator type"), field("display_digits", "Display digits", "number"), field("power_source", "Power source"), field("functions", "Functions", "multi_select", { allowCustom: true }), dimensions],
  office_accessory: [brand, field("accessory_type", "Accessory type"), material, field("compatible_devices", "Compatible devices", "multi_select", { allowCustom: true }), dimensions, colours],
  study_equipment: [brand, field("equipment_type", "Equipment type"), field("subject_or_use", "Subject / use"), material, field("power_source", "Power source"), dimensions, colours],
  fitness_equipment: [brand, field("equipment_type", "Equipment type"), field("target_muscles", "Target muscles", "multi_select", { allowCustom: true }), field("max_supported_weight", "Maximum supported weight", "measurement", { units: ["kg", "lb"] }), dimensions, weight, material],
  training_accessory: [brand, field("accessory_type", "Accessory type"), field("sport_or_activity", "Sport / activity", "multi_select", { allowCustom: true }), material, field("size", "Size", "custom_select", { allowCustom: true, variationRelated: true }), colours],
  outdoor_equipment: [brand, field("equipment_type", "Equipment type"), field("intended_activity", "Intended activity", "multi_select", { allowCustom: true }), material, weight, dimensions, field("weather_resistant", "Weather resistant", "boolean")],
  exercise_accessory: [brand, field("accessory_type", "Accessory type"), field("resistance_level", "Resistance level", "custom_select", { allowCustom: true }), material, field("length", "Length", "measurement", { units: ["cm", "m", "in"] }), weight],
  toy: [brand, field("toy_type", "Toy type"), field("age_recommendation", "Age recommendation"), material, dimensions, field("battery_required", "Battery required", "boolean"), field("safety_standard", "Safety standard")],
  educational_toy: [brand, field("learning_area", "Learning area", "multi_select", { allowCustom: true }), field("age_recommendation", "Age recommendation"), material, field("number_of_pieces", "Number of pieces", "number"), field("languages", "Languages", "multi_select", { allowCustom: true }), field("battery_required", "Battery required", "boolean")],
  baby_accessory: [brand, field("product_type", "Product type"), material, field("age_range", "Age range"), field("safety_features", "Safety features", "multi_select", { allowCustom: true }), field("care_instructions", "Care instructions"), colours],
  children_clothing: [brand, field("garment_type", "Garment type"), material, size, colours, field("age_range", "Age range", "custom_select", { allowCustom: true }), field("care_instructions", "Care instructions")],
  game: [brand, field("game_type", "Game type"), field("player_count", "Number of players"), field("age_recommendation", "Age recommendation"), field("play_time", "Playing time", "measurement", { units: ["min", "h"] }), field("languages", "Languages", "multi_select", { allowCustom: true }), field("included_items", "Included items", "multi_select", { allowCustom: true })],
  kids_product: [brand, field("product_type", "Product type"), field("age_range", "Age range"), material, dimensions, field("safety_features", "Safety features", "multi_select", { allowCustom: true }), colours],
  furniture: [brand, field("furniture_type", "Furniture type"), material, dimensions, field("seating_capacity", "Seating capacity", "number"), field("assembly_required", "Assembly required", "boolean"), field("finish", "Finish"), colours],
  home_decoration: [brand, field("decoration_type", "Decoration type"), material, dimensions, field("room_suitability", "Room suitability", "multi_select", { allowCustom: true }), field("mounting_type", "Mounting type"), colours],
  lighting: [brand, field("lighting_type", "Lighting type"), field("bulb_type", "Bulb type"), field("wattage", "Wattage", "measurement", { units: ["W"] }), field("light_colour", "Light colour"), field("dimmable", "Dimmable", "boolean"), voltage],
  bedding: [brand, field("bedding_type", "Bedding type"), material, field("bed_size", "Bed size", "custom_select", { options: ["Single", "Double", "Queen", "King"], allowCustom: true, variationRelated: true }), field("thread_count", "Thread count", "number"), colours, field("care_instructions", "Care instructions")],
  storage_organisation: [brand, field("organiser_type", "Storage type"), material, dimensions, field("capacity", "Capacity", "measurement", { units: ["L", "ml"] }), field("stackable", "Stackable", "boolean"), colours],
  kitchenware: [brand, field("item_type", "Kitchenware type"), material, field("pieces_in_set", "Pieces in set", "number"), field("dishwasher_safe", "Dishwasher safe", "boolean"), field("heat_safe", "Heat safe", "boolean"), colours],
  bathroom_accessory: [brand, field("accessory_type", "Accessory type"), material, dimensions, field("mounting_type", "Mounting type"), field("water_resistant", "Water resistant", "boolean"), colours],
  car_accessory: [brand, field("accessory_type", "Accessory type"), field("vehicle_compatibility", "Vehicle compatibility", "multi_select", { allowCustom: true, filterable: true }), material, field("installation_type", "Installation type"), dimensions],
  car_electronics: [brand, model, field("device_type", "Device type"), field("vehicle_compatibility", "Vehicle compatibility", "multi_select", { allowCustom: true, filterable: true }), field("connectivity", "Connectivity", "multi_select", { allowCustom: true }), field("power_source", "Power source"), voltage],
  interior_accessory: [brand, field("accessory_type", "Accessory type"), field("vehicle_compatibility", "Vehicle compatibility", "multi_select", { allowCustom: true, filterable: true }), material, field("installation_type", "Installation type"), colours],
  exterior_accessory: [brand, field("accessory_type", "Accessory type"), field("vehicle_compatibility", "Vehicle compatibility", "multi_select", { allowCustom: true, filterable: true }), material, field("installation_type", "Installation type"), field("weather_resistant", "Weather resistant", "boolean")],
  car_cleaning: [brand, field("product_type", "Product type"), field("suitable_surfaces", "Suitable surfaces", "multi_select", { allowCustom: true }), field("volume", "Net volume", "measurement", { units: ["ml", "L"] }), field("application_method", "Application method"), field("scent", "Scent")],
  travel_bag: [brand, field("bag_type", "Bag type"), material, field("capacity", "Capacity", "measurement", { units: ["L"] }), dimensions, field("compartments", "Compartments", "number"), field("carry_on_compatible", "Carry-on compatible", "boolean"), colours],
  luggage: [brand, field("luggage_type", "Luggage type"), material, field("capacity", "Capacity", "measurement", { units: ["L"] }), dimensions, field("wheel_count", "Wheel count", "number"), field("lock_type", "Lock type"), colours],
  travel_accessory: [brand, field("accessory_type", "Accessory type"), material, field("travel_compatibility", "Travel compatibility", "multi_select", { allowCustom: true }), dimensions, weight],
  everyday_carry: [brand, field("item_type", "Item type"), material, dimensions, weight, field("pocket_or_compartment_count", "Pockets / compartments", "number"), colours],
  lifestyle: [brand, field("product_type", "Product type"), material, field("intended_use", "Intended use"), dimensions, weight, colours],
};

export const CATEGORY_SUBCATEGORY_SLUGS: Readonly<Record<string, readonly string[]>> = {
  "phones-mobile-devices": ["smartphones", "android-phones", "iphones", "tablets", "phone-accessories", "phone-cases-screen-protectors", "chargers-cables", "power-banks"],
  "computers-laptops": ["laptops", "desktop-computers", "monitors", "keyboards", "mice", "storage-devices", "computer-accessories", "laptop-bags", "networking-equipment"],
  gaming: ["gaming-consoles", "playstation-accessories", "xbox-accessories", "nintendo-accessories", "gaming-controllers", "gaming-headsets", "gaming-keyboards-mice", "gaming-chairs", "gaming-monitors", "gaming-accessories"],
  electronics: ["headphones-earbuds", "speakers", "smartwatches", "cameras", "smart-home-devices", "tvs-entertainment-devices", "electronic-accessories", "projectors"],
  "home-appliances": ["kitchen-appliances", "refrigerators-freezers", "washing-machines", "air-conditioners", "fans", "vacuum-cleaners", "irons", "blenders", "microwaves", "other-household-appliances"],
  "fashion-clothing": ["mens-clothing", "womens-clothing", "shoes", "sneakers", "bags", "watches", "jewellery", "fashion-accessories", "sportswear"],
  "beauty-skincare-personal-care": ["skincare", "facial-cleansers", "moisturisers", "serums", "sunscreen", "makeup", "haircare", "beauty-tools", "personal-care-products"],
  "anime-collectibles": ["anime-figures", "anime-clothing", "anime-accessories", "plushies", "posters", "collectibles", "cosplay-products", "anime-inspired-merchandise"],
  "school-office-supplies": ["school-bags", "backpacks", "notebooks", "stationery", "pens-pencils", "calculators", "office-accessories", "study-equipment"],
  "sports-outdoor": ["fitness-equipment", "sportswear", "training-accessories", "outdoor-equipment", "exercise-accessories"],
  "toys-kids-baby": ["toys", "educational-toys", "baby-accessories", "childrens-clothing", "games", "kids-products"],
  "home-furniture-living": ["furniture", "home-decoration", "lighting", "bedding", "storage-organisation", "kitchenware", "bathroom-accessories"],
  "automotive-accessories": ["car-accessories", "car-electronics", "interior-accessories", "exterior-accessories", "car-cleaning-products"],
  "travel-lifestyle": ["travel-bags", "luggage", "travel-accessories", "everyday-carry-accessories", "lifestyle-products"],
};

export function specificationTemplateKey(categorySlug: string, subcategorySlug: string): string {
  return `${categorySlug}:${subcategorySlug}`;
}

const subcategoryFamilies: Record<string, Family> = {
  smartphones: "smartphone", "android-phones": "smartphone", iphones: "smartphone", tablets: "tablet", "phone-accessories": "mobile_accessory", "phone-cases-screen-protectors": "phone_case", "chargers-cables": "charger", "power-banks": "power_bank",
  laptops: "laptop", "desktop-computers": "desktop", monitors: "display", keyboards: "keyboard", mice: "mouse", "storage-devices": "storage", "computer-accessories": "computer_accessory", "laptop-bags": "laptop_bag", "networking-equipment": "networking",
  "gaming-consoles": "console", "playstation-accessories": "platform_accessory", "xbox-accessories": "platform_accessory", "nintendo-accessories": "platform_accessory", "gaming-controllers": "controller", "gaming-headsets": "headset", "gaming-keyboards-mice": "gaming_keyboard", "gaming-chairs": "gaming_chair", "gaming-monitors": "gaming_monitor", "gaming-accessories": "gaming_accessory",
  "headphones-earbuds": "audio", speakers: "speaker", smartwatches: "smartwatch", cameras: "camera", "smart-home-devices": "smart_home", "tvs-entertainment-devices": "television", "electronic-accessories": "electronic_accessory", projectors: "projector",
  "kitchen-appliances": "kitchen_appliance", "refrigerators-freezers": "refrigerator", "washing-machines": "washing_machine", "air-conditioners": "air_conditioner", fans: "fan", "vacuum-cleaners": "vacuum", irons: "iron", blenders: "blender", microwaves: "microwave", "other-household-appliances": "household_appliance",
  "mens-clothing": "clothing", "womens-clothing": "clothing", shoes: "shoe", sneakers: "shoe", bags: "bag", watches: "fashion_watch", jewellery: "jewellery", "fashion-accessories": "fashion_accessory", sportswear: "sportswear",
  skincare: "skincare", "facial-cleansers": "cleanser", moisturisers: "moisturiser", serums: "serum", sunscreen: "sunscreen", makeup: "makeup", haircare: "haircare", "beauty-tools": "beauty_tool", "personal-care-products": "personal_care",
  "anime-figures": "figure", "anime-clothing": "anime_clothing", "anime-accessories": "anime_accessory", plushies: "plush", posters: "poster", collectibles: "collectible", "cosplay-products": "cosplay", "anime-inspired-merchandise": "anime_merch",
  "school-bags": "school_bag", backpacks: "backpack", notebooks: "notebook", stationery: "stationery", "pens-pencils": "writing_tool", calculators: "calculator", "office-accessories": "office_accessory", "study-equipment": "study_equipment",
  "fitness-equipment": "fitness_equipment", "training-accessories": "training_accessory", "outdoor-equipment": "outdoor_equipment", "exercise-accessories": "exercise_accessory",
  toys: "toy", "educational-toys": "educational_toy", "baby-accessories": "baby_accessory", "childrens-clothing": "children_clothing", games: "game", "kids-products": "kids_product",
  furniture: "furniture", "home-decoration": "home_decoration", lighting: "lighting", bedding: "bedding", "storage-organisation": "storage_organisation", kitchenware: "kitchenware", "bathroom-accessories": "bathroom_accessory",
  "car-accessories": "car_accessory", "car-electronics": "car_electronics", "interior-accessories": "interior_accessory", "exterior-accessories": "exterior_accessory", "car-cleaning-products": "car_cleaning",
  "travel-bags": "travel_bag", luggage: "luggage", "travel-accessories": "travel_accessory", "everyday-carry-accessories": "everyday_carry", "lifestyle-products": "lifestyle",
};

export const DEFAULT_SPECIFICATION_TEMPLATES: SpecificationTemplateMap = Object.fromEntries(
  Object.entries(CATEGORY_SUBCATEGORY_SLUGS).flatMap(([categorySlug, subcategorySlugs]) => subcategorySlugs.map((subcategorySlug) => {
    const key = specificationTemplateKey(categorySlug, subcategorySlug);
    const family = categorySlug === "fashion-clothing" && subcategorySlug === "sportswear" ? "fashion_sportswear" : subcategoryFamilies[subcategorySlug];
    if (!family) throw new Error(`Missing product specification family for ${key}`);
    return [key, families[family].map((entry) => ({ ...entry, options: entry.options ? [...entry.options] : undefined, units: entry.units ? [...entry.units] : undefined }))];
  })),
);

const knownFieldTypes = new Set<SpecificationFieldType>(["text", "number", "select", "custom_select", "multi_select", "boolean", "measurement"]);

function cleanField(value: unknown): SpecificationField | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const key = typeof raw.key === "string" ? raw.key.trim().slice(0, 80) : "";
  const label = typeof raw.label === "string" ? raw.label.trim().slice(0, 100) : "";
  const type = typeof raw.type === "string" ? raw.type as SpecificationFieldType : "text";
  if (!/^[a-z0-9][a-z0-9_ -]*$/i.test(key) || !label || !knownFieldTypes.has(type)) return null;
  const options = Array.isArray(raw.options) ? raw.options.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 100)).filter(Boolean).slice(0, 100) : undefined;
  const units = Array.isArray(raw.units) ? raw.units.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 24)).filter(Boolean).slice(0, 20) : undefined;
  const unit = typeof raw.unit === "string" ? raw.unit.trim().slice(0, 24) : undefined;
  return {
    key, label, type, options, units, unit,
    required: raw.required === true,
    allowCustom: raw.allowCustom === true,
    customerVisible: raw.customerVisible !== false,
    filterable: raw.filterable === true,
    variationRelated: raw.variationRelated === true,
  };
}

export function normalizeTemplateMap(value: unknown): SpecificationTemplateMap {
  const normalized: SpecificationTemplateMap = Object.fromEntries(
    Object.entries(DEFAULT_SPECIFICATION_TEMPLATES).map(([slug, entries]) => [slug, entries.map((entry) => ({ ...entry }))]),
  );
  if (!value || typeof value !== "object" || Array.isArray(value)) return normalized;
  for (const [slug, rawFields] of Object.entries(value as Record<string, unknown>)) {
    if (!(slug in normalized)) continue;
    if (!Array.isArray(rawFields) || rawFields.length > 120) continue;
    const fields = rawFields.map(cleanField).filter((entry): entry is SpecificationField => Boolean(entry));
    const unique = new Set<string>();
    normalized[slug] = fields.filter((entry) => {
      if (unique.has(entry.key)) return false;
      unique.add(entry.key);
      return true;
    });
  }
  return normalized;
}

export function templateForSubcategory(categorySlug: string | null | undefined, subcategorySlug: string | null | undefined, templates: SpecificationTemplateMap = DEFAULT_SPECIFICATION_TEMPLATES): SpecificationField[] {
  if (!categorySlug || !subcategorySlug) return [];
  const fields = templates[specificationTemplateKey(categorySlug, subcategorySlug)] || templates[subcategorySlug] || [];
  return fields.map((entry) => ({ ...entry, options: entry.options ? [...entry.options] : undefined, units: entry.units ? [...entry.units] : undefined }));
}

export function allKnownSpecificationKeys(templates: SpecificationTemplateMap = DEFAULT_SPECIFICATION_TEMPLATES): Set<string> {
  return new Set(Object.values(templates).flatMap((entries) => entries.map((entry) => entry.key)));
}

export function normalizeSpecificationValues(value: unknown): Record<string, SpecificationValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, SpecificationValue> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") result[key] = raw;
    else if (Array.isArray(raw)) result[key] = raw.filter((item): item is string => typeof item === "string");
    else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const measurement = raw as Record<string, unknown>;
      if (typeof measurement.value === "number" && Number.isFinite(measurement.value) && typeof measurement.unit === "string" && measurement.unit.trim()) {
        result[key] = { value: measurement.value, unit: measurement.unit.trim().slice(0, 24) };
      }
    }
  }
  return result;
}

export function normalizeFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))).slice(0, 40);
}

export function categoryAwareTemplateCount(templates: SpecificationTemplateMap = DEFAULT_SPECIFICATION_TEMPLATES): number {
  return Object.keys(templates).length;
}
