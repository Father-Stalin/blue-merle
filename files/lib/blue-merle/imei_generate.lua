#!/usr/bin/env lua

-- IMEI generator and setter rewritten from imei_generate.py

local Modes = {
  DETERMINISTIC = "deterministic",
  RANDOM = "random",
  STATIC = "static",
}

local imei_length = 14 -- without validation digit
local imei_prefixes = {
  "35674108", "35290611", "35397710", "35323210", "35384110",
  "35982748", "35672011", "35759049", "35266891", "35407115",
  "35538025", "35480910", "35324590", "35901183", "35139729",
  "35479164",
}

local TTY = "/dev/ttyUSB3"
local BAUDRATE = 9600
local TIMEOUT = 3

local verbose = false
local mode = Modes.RANDOM
local MAX_SEED = 0x7fffffff

local function log(msg)
  if verbose then
    io.stdout:write(msg .. "\n")
  end
end

local function trim(s)
  return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function run_command(cmd)
  local handle, err = io.popen(cmd, "r")
  if not handle then
    return nil, err
  end
  local output = handle:read("*a")
  handle:close()
  return output
end

local function run_gl_modem(at_command)
  local full_cmd = string.format("gl_modem AT %s 2>/dev/null", at_command)
  log("Executing: " .. full_cmd)
  local output, err = run_command(full_cmd)
  if not output then
    return nil, err
  end
  if verbose then
    log("Raw modem output:\n" .. trim(output))
  end
  return output
end

local function collect_digits(output, min_len, max_len)
  local pieces = {}
  for token in output:gmatch("%d+") do
    local len = #token
    if len >= (min_len or len) and len <= (max_len or len) then
      table.insert(pieces, token)
    end
  end
  return table.concat(pieces)
end

local function get_imsi()
  log(string.format("Obtaining IMSI via %s with timeout %d...", TTY, TIMEOUT))
  local output, err = run_gl_modem("'AT+CIMI'")
  if not output then
    return nil, "Failed to run AT+CIMI: " .. (err or "unknown error")
  end
  local imsi = collect_digits(output, 6, 15)
  if verbose then
    log("Parsed IMSI: " .. (imsi ~= "" and imsi or "nil"))
  end
  if imsi == "" then
    return nil, "No IMSI digits found in modem response"
  end
  return imsi
end

local function get_imei()
  local output, err = run_gl_modem("'AT+GSN'")
  if not output then
    return nil, "Failed to run AT+GSN: " .. (err or "unknown error")
  end
  local imei = collect_digits(output, 14, 15)
  if verbose then
    log("Parsed IMEI: " .. (imei ~= "" and imei or "nil"))
  end
  if imei == "" then
    return nil, "No IMEI digits found in modem response"
  end
  return imei
end

local function set_imei(imei)
  local quoted_command = string.format("'AT+EGMR=1,7,\"%s\"'", imei)
  local _, err = run_gl_modem(quoted_command)
  if err then
    print("Failed to write IMEI: " .. err)
    return false
  end
  local new_imei, read_err = get_imei()
  if not new_imei then
    print("Unable to verify IMEI: " .. read_err)
    return false
  end
  if new_imei == imei then
    print("IMEI has been successfully changed.")
    return true
  end
  print("IMEI has not been successfully changed.")
  return false
end

local function luhn_sum(body)
  local sum = 0
  for i = 1, #body do
    local digit = tonumber(body:sub(i, i))
    if not digit then
      return nil, string.format("Non-digit character '%s' in IMEI body", body:sub(i, i))
    end
    if i % 2 == 0 then
      digit = digit * 2
    end
    if digit > 9 then
      digit = digit - 9
    end
    sum = sum + digit
  end
  return sum
end

local function calculate_luhn(body)
  local sum, err = luhn_sum(body)
  if not sum then
    return nil, err
  end
  return (10 - (sum % 10)) % 10
end

local function validate_imei(imei)
  if #imei ~= 15 then
    print(string.format("NOT A VALID IMEI: %s - IMEI must be 15 characters in length", imei))
    return false
  end
  local validation_digit = tonumber(imei:sub(-1))
  if not validation_digit then
    print(string.format("NOT A VALID IMEI: %s - Invalid trailing digit", imei))
    return false
  end
  local body = imei:sub(1, 14)
  local expected, err = calculate_luhn(body)
  if not expected then
    print(string.format("NOT A VALID IMEI: %s - %s", imei, err))
    return false
  end
  if validation_digit == expected then
    print(string.format("%s is CORRECT", imei))
    return true
  end
  print(string.format("NOT A VALID IMEI: %s", imei))
  return false
end

local function shuffle_digits(count)
  local digits = {}
  for i = 0, 9 do
    table.insert(digits, tostring(i))
  end
  local result = {}
  for _ = 1, count do
    if #digits == 0 then
      break
    end
    local idx = math.random(#digits)
    table.insert(result, table.remove(digits, idx))
  end
  return table.concat(result)
end

local function derive_seed(value)
  local numeric = tonumber(value)
  if not numeric then
    return nil, string.format("Unable to derive RNG seed from '%s'", tostring(value))
  end
  local integer = math.floor(numeric)
  if integer < 0 then
    integer = -integer
  end
  return integer % MAX_SEED
end

local function entropy_seed()
  local time_part = os.time() % MAX_SEED
  local clock_part = math.floor((os.clock() % 1) * 1e6) % MAX_SEED
  local addr = tostring({}):match("0x([%da-fA-F]+)")
  local addr_part = 0
  if addr then
    addr_part = tonumber(addr, 16) % MAX_SEED
  end
  return (time_part * 1000000 + clock_part + addr_part) % MAX_SEED
end

local function reseed_random(seed_value)
  local seed, err
  if seed_value ~= nil then
    seed, err = derive_seed(seed_value)
    if not seed then
      return nil, err
    end
  else
    seed = entropy_seed()
  end
  math.randomseed(seed)
  math.random(); math.random(); math.random()
  return seed
end

local function generate_imei(prefixes, imsi)
  if mode == Modes.DETERMINISTIC then
    local _, err = reseed_random(imsi)
    if err then
      return nil, err
    end
  end
  local prefix = prefixes[math.random(#prefixes)]
  log("IMEI prefix: " .. prefix)
  local random_part_length = imei_length - #prefix
  log("Length of the random IMEI part: " .. random_part_length)
  local random_part = shuffle_digits(random_part_length)
  local body = prefix .. random_part
  log("IMEI without validation digit: " .. body)
  local check_digit, err = calculate_luhn(body)
  if not check_digit then
    return nil, err
  end
  log("Validation digit: " .. check_digit)
  local imei = body .. tostring(check_digit)
  log("Resulting IMEI: " .. imei)
  return imei
end

local function usage()
  io.stdout:write([[
Usage: imei_generate.lua [options]

Options:
  -v, --verbose            Enables verbose output
  -g, --generate-only      Generate an IMEI but do not apply it
  -d, --deterministic      Deterministic mode (seeded with IMSI)
  -s, --static <IMEI>      Set a user-specified IMEI
  -r, --random             Generate a random IMEI (default)
  -h, --help               Show this message
]])
end

local function parse_args(argv)
  local opts = {
    generate_only = false,
    deterministic = false,
    random = false,
    static_value = nil,
    verbose = false,
  }

  local i = 1
  while i <= #argv do
    local token = argv[i]
    if token == "-v" or token == "--verbose" then
      opts.verbose = true
    elseif token == "-g" or token == "--generate-only" then
      opts.generate_only = true
    elseif token == "-d" or token == "--deterministic" then
      opts.deterministic = true
    elseif token == "-r" or token == "--random" then
      opts.random = true
    elseif token == "-s" or token == "--static" then
      i = i + 1
      if i > #argv then
        return nil, "Missing value for --static"
      end
      opts.static_value = argv[i]
    elseif token:match("^%-%-static=") then
      opts.static_value = token:match("^%-%-static=(.+)$")
    elseif token == "-h" or token == "--help" then
      usage()
      os.exit(0)
    else
      return nil, "Unknown argument: " .. token
    end
    i = i + 1
  end
  return opts
end

local function ensure_mode(opts)
  local mode_count = 0
  if opts.deterministic then mode_count = mode_count + 1 end
  if opts.random then mode_count = mode_count + 1 end
  if opts.static_value then mode_count = mode_count + 1 end
  if mode_count > 1 then
    return nil, "Only one of --deterministic, --random, or --static may be specified"
  end
  if opts.static_value then
    return Modes.STATIC
  elseif opts.deterministic then
    return Modes.DETERMINISTIC
  else
    return Modes.RANDOM
  end
end

local function main(argv)
  local opts, err = parse_args(argv)
  if not opts then
    io.stderr:write(err .. "\n")
    usage()
    return 1
  end

  verbose = opts.verbose
  mode, err = ensure_mode(opts)
  if not mode then
    io.stderr:write(err .. "\n")
    usage()
    return 1
  end

  local _, seed_err = reseed_random()
  if seed_err then
    io.stderr:write(seed_err .. "\n")
    return 1
  end

  if mode == Modes.STATIC then
    local static_imei = opts.static_value
    if not static_imei then
      io.stderr:write("Static mode requires an IMEI value\n")
      return 1
    end
    if validate_imei(static_imei) then
      if not set_imei(static_imei) then
        return 1
      end
    else
      return 1
    end
  else
    local imsi = nil
    if mode == Modes.DETERMINISTIC then
      local err_get
      imsi, err_get = get_imsi()
      if not imsi then
        io.stderr:write(err_get .. "\n")
        return 1
      end
    end
    local imei, gen_err = generate_imei(imei_prefixes, imsi)
    if not imei then
      io.stderr:write("Failed to generate IMEI: " .. gen_err .. "\n")
      return 1
    end
    if verbose then
      log("Generated new IMEI: " .. imei)
    end
    if opts.generate_only then
      print(imei)
    else
      if not set_imei(imei) then
        return 1
      end
    end
  end

  return 0
end

os.exit(main(arg))
