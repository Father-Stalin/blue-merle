#!/usr/bin/env ash

# This script provides helper functions for blue-merle


UNICAST_MAC_GEN () {
    local mac

    mac=$(lua - <<'EOF'
local urandom = io.open("/dev/urandom", "rb")
if not urandom then os.exit(1) end

local bytes = urandom:read(6)
urandom:close()

if not bytes or #bytes ~= 6 then os.exit(1) end

local b = {bytes:byte(1, 6)}

-- Clear multicast bit, set locally administered bit
b[1] = (b[1] - (b[1] % 4)) + 2

io.write(string.format("%02x:%02x:%02x:%02x:%02x:%02x", b[1], b[2], b[3], b[4], b[5], b[6]))
EOF
)
    [ $? -eq 0 ] || return 1
    echo "$mac"
}

# randomize BSSID
RESET_BSSIDS () {
    uci set wireless.@wifi-iface[1].macaddr=`UNICAST_MAC_GEN`
    uci set wireless.@wifi-iface[0].macaddr=`UNICAST_MAC_GEN`
    uci commit wireless
    # you need to reset wifi for changes to apply, i.e. executing "wifi"
}


RANDOMIZE_MACADDR () {
    # This changes the MAC address clients see when connecting to the WiFi spawned by the device.
    # You can check with "arp -a" that your endpoint, e.g. your laptop, sees a different MAC after a reboot of the Mudi.
    uci set network.@device[1].macaddr=`UNICAST_MAC_GEN`
    # Here we change the MAC address the upstream wifi sees
    uci set glconfig.general.macclone_addr=`UNICAST_MAC_GEN`
    uci commit network
    # You need to restart the network, i.e. /etc/init.d/network restart
}

NORMALIZE_MAC () {
    local mac="$1"

    mac=$(printf '%s' "$mac" | tr '[:lower:]' '[:upper:]')
    mac=${mac//[^0-9A-F]/}

    if [ ${#mac} -ne 12 ]; then
        return 1
    fi .    
    printf '%s:%s:%s:%s:%s:%s\n' \
        "${mac:0:2}" "${mac:2:2}" "${mac:4:2}" \
        "${mac:6:2}" "${mac:8:2}" "${mac:10:2}"
}

MAC_FROM_PREFIX () {
    local prefix="$1"
    local vendor rand mac

    vendor=$(printf '%s' "$prefix" | tr '[:lower:]' '[:upper:]')
    vendor=${vendor//[^0-9A-F]/}
    vendor=${vendor:0:6}

    if [ ${#vendor} -ne 6 ]; then
        return 1
    fi

    rand=$(dd if=/dev/urandom bs=3 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')
    if [ ${#rand} -ne 6 ]; then
        return 1
    fi

    mac="${vendor}${rand}"
    printf '%s:%s:%s:%s:%s:%s\n' \
        "${mac:0:2}" "${mac:2:2}" "${mac:4:2}" \
        "${mac:6:2}" "${mac:8:2}" "${mac:10:2}"
}

SET_MAC_IF_AVAILABLE () {
    local uci_path="$1"
    local mac="$2"

    if [ -z "$uci_path" ] || [ -z "$mac" ]; then
        return 1
    fi

    if uci -q get "$uci_path" >/dev/null 2>&1; then
        uci set "$uci_path"="$mac"
        return 0
    fi

    return 1
}

READ_ICCID() {
    gl_modem AT AT+CCID
}


READ_IMEI () {
	local answer=1
	while [[ "$answer" -eq 1 ]]; do
	        local imei=$(gl_modem AT AT+GSN | grep -w -E "[0-9]{14,15}")
	        if [[ $? -eq 1 ]]; then
                	echo -n "Failed to read IMEI. Try again? (Y/n): "
	                read answer
	                case $answer in
	                        n*) answer=0;;
	                        N*) answer=0;;
	                        *) answer=1;;
	                esac
	                if [[ $answer -eq 0 ]]; then
	                        exit 1
	                fi
	        else
	                answer=0
	        fi
	done
	echo $imei
}

READ_IMSI () {
	local answer=1
	while [[ "$answer" -eq 1 ]]; do
	        local imsi=$(gl_modem AT AT+CIMI | grep -w -E "[0-9]{6,15}")
	        if [[ $? -eq 1 ]]; then
                	echo -n "Failed to read IMSI. Try again? (Y/n): "
	                read answer
	                case $answer in
	                        n*) answer=0;;
	                        N*) answer=0;;
	                        *) answer=1;;
	                esac
	                if [[ $answer -eq 0 ]]; then
	                        exit 1
	                fi
	        else
	                answer=0
	        fi
	done
	echo $imsi
}


GENERATE_IMEI() {
    local seed=$(head -100 /dev/urandom | tr -dc "0123456789" | head -c10)
    local imei=$(lua /lib/blue-merle/luhn.lua $seed)
    echo -n $imei
}

SET_IMEI() {
    local imei="$1"

    if [[ ${#imei} -eq 14 ]]; then
        gl_modem AT AT+EGMR=1,7,${imei}
    else
        echo "IMEI is ${#imei} not 14 characters long"
    fi
}

CHECK_ABORT () {
        sim_change_switch=`cat /tmp/sim_change_switch`
        if [[ "$sim_change_switch" = "off" ]]; then
                echo '{ "msg": "SIM change      aborted." }' > /dev/ttyS0
                sleep 1
                exit 1
        fi
}
