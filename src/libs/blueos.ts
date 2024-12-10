import ky, { HTTPError } from 'ky'

import { useMainVehicleStore } from '@/stores/mainVehicle'
import { BlueOsWidget } from '@/types/widgets'

export const NoPathInBlueOsErrorName = 'NoPathInBlueOS'

const defaultTimeout = 10000

/* eslint-disable @typescript-eslint/no-explicit-any */
export const getBagOfHoldingFromVehicle = async (
  vehicleAddress: string,
  bagPath: string
): Promise<Record<string, any> | any> => {
  try {
    const options = { timeout: defaultTimeout, retry: 0 }
    return await ky.get(`http://${vehicleAddress}/bag/v1.0/get/${bagPath}`, options).json()
  } catch (error) {
    console.error(error)
    if (errorBody.detail === 'Invalid path') {
      const noPathError = new Error(`No data available in BlueOS storage for path '${bagPath}'.`)
      noPathError.name = NoPathInBlueOsErrorName
      throw noPathError
    }
    throw new Error(`Could not get bag of holdings for ${bagPath}. ${error}`)
  }
}

export const getKeyDataFromCockpitVehicleStorage = async (
  vehicleAddress: string,
  storageKey: string
): Promise<Record<string, any> | undefined> => {
  return await getBagOfHoldingFromVehicle(vehicleAddress, `cockpit/${storageKey}`)
}

export const getWidgetsFromBlueOS = async (): Promise<BlueOsWidget[]> => {
  const vehicleStore = useMainVehicleStore()

  // Wait until we have a global address
  while (vehicleStore.globalAddress === undefined) {
    console.debug('Waiting for vehicle global address on BlueOS sync routine.')
    await new Promise((r) => setTimeout(r, 1000))
  }
  try {
    const options = { timeout: defaultTimeout, retry: 0 }
    const data = (await ky
      .get(`http://${vehicleStore.globalAddress}/helper/v1.0/web_services`, options)
      .json()) as Record<string, any>
    console.log(data)
    // Extract the 'metadata.cockpit_widget' keys from the leaf nodes
    let widgets: BlueOsWidget[] = []
    for (const key of Object.keys(data)) {
      const value = data[key]
      if (typeof value === 'object') {
        if (value.metadata && value.metadata.cockpit_widget) {
          const newWidgets: BlueOsWidget[] = value.metadata.cockpit_widget.map((widget: BlueOsWidget) => {
            return {
              ...widget,
              url: `http://${vehicleStore.globalAddress}:${value.port}${widget.url}`,
            }
          })
          widgets = [...widgets, ...newWidgets]
        }
      }
    }
    return widgets
  } catch (error) {
    const errorBody = await (error as HTTPError).response.json()
    console.error(errorBody)
  }
  return []
}

export const setBagOfHoldingOnVehicle = async (
  vehicleAddress: string,
  bagName: string,
  bagData: Record<string, any> | any
): Promise<void> => {
  try {
    await ky.post(`http://${vehicleAddress}/bag/v1.0/set/${bagName}`, { json: bagData, timeout: defaultTimeout })
  } catch (error) {
    throw new Error(`Could not set bag of holdings for ${bagName}. ${error}`)
  }
}

export const setKeyDataOnCockpitVehicleStorage = async (
  vehicleAddress: string,
  storageKey: string,
  storageData: Record<string, any> | any
): Promise<void> => {
  await setBagOfHoldingOnVehicle(vehicleAddress, `cockpit/${storageKey}`, storageData)
}

/* eslint-disable jsdoc/require-jsdoc */
type RawIpInfo = { ip: string; service_type: string; interface_type: string }
type IpInfo = { ipv4Address: string; interfaceType: string }
/* eslint-enable jsdoc/require-jsdoc */

export const getIpsInformationFromVehicle = async (vehicleAddress: string): Promise<IpInfo[]> => {
  try {
    const url = `http://${vehicleAddress}/beacon/v1.0/services`
    const rawIpsInfo: RawIpInfo[] = await ky.get(url, { timeout: defaultTimeout }).json()
    return rawIpsInfo
      .filter((ipInfo) => ipInfo['service_type'] === '_http')
      .map((ipInfo) => ({ ipv4Address: ipInfo.ip, interfaceType: ipInfo.interface_type }))
  } catch (error) {
    throw new Error(`Could not get information about IPs on BlueOS. ${error}`)
  }
}

/* eslint-disable jsdoc/require-jsdoc */
type RawM2rServiceInfo = { name: string; version: string; sha: string; build_date: string; authors: string }
type RawM2rInfo = { version: number; service: RawM2rServiceInfo }
/* eslint-enable jsdoc/require-jsdoc */

export const getMavlink2RestVersion = async (vehicleAddress: string): Promise<string> => {
  try {
    const url = `http://${vehicleAddress}/mavlink2rest/info`
    const m2rRawInfo: RawM2rInfo = await ky.get(url, { timeout: defaultTimeout }).json()
    return m2rRawInfo.service.version
  } catch (error) {
    throw new Error(`Could not get Mavlink2Rest version. ${error}`)
  }
}

/* eslint-disable jsdoc/require-jsdoc */
type RawArdupilotFirmwareInfo = { version: string; type: string }
/* eslint-enable jsdoc/require-jsdoc */

export const getArdupilotVersion = async (vehicleAddress: string): Promise<string> => {
  try {
    const url = `http://${vehicleAddress}/ardupilot-manager/v1.0/firmware_info`
    const ardupilotFirmwareRawInfo: RawArdupilotFirmwareInfo = await ky.get(url, { timeout: defaultTimeout }).json()
    return ardupilotFirmwareRawInfo.version
  } catch (error) {
    throw new Error(`Could not get Ardupilot firmware version. ${error}`)
  }
}

export const getStatus = async (vehicleAddress: string): Promise<boolean> => {
  try {
    const url = `http://${vehicleAddress}/status`
    const result = await ky.get(url, { timeout: defaultTimeout })
    return result.ok
  } catch (error) {
    throw new Error(`Could not get BlueOS status. ${error}`)
  }
}

// eslint-disable-next-line jsdoc/require-jsdoc
type RawCpuTempInfo = { name: string; temperature: number; maximum_temperature: number; critical_temperature: number }

export const getCpuTempCelsius = async (vehicleAddress: string): Promise<number> => {
  try {
    const url = `http://${vehicleAddress}/system-information/system/temperature`
    const cpuTempRawInfo: RawCpuTempInfo[] = await ky.get(url, { timeout: defaultTimeout }).json()
    return cpuTempRawInfo[0].temperature
  } catch (error) {
    throw new Error(`Could not get temperature of the BlueOS CPU. ${error}`)
  }
}
