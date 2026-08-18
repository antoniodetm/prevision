const API_KEY_AEMET = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbnRvbmlvZGV0bUBnbWFpbC5jb20iLCJqdGkiOiIzZTcxNTZmNC05YzZiLTQyMDMtYmE2YS0zZTRiYTAxMmQxNDUiLCJleHAiOjE3OTU1MDI1OTksImlzcyI6IkFFTUVUIiwiaWF0IjoxNzg2ODYyNTk5LCJ1c2VySWQiOiIzZTcxNTZmNC05YzZiLTQyMDMtYmE2YS0zZTRiYTAxMmQxNDUiLCJyb2xlIjoiIn0.PhW1cv27D88wKrZb2kFFP2NqQVmy23h35uiYjVTjqFY';
let municipiosCache = null;

/**
 * Función auxiliar para realizar la petición de 2 pasos a la API de AEMET.
 * @param {string} urlPeticion La URL inicial de la petición a AEMET.
 * @returns {Promise<any|null>} Los datos en formato JSON o null si hay un error.
 */
async function _fetchAemetData(urlPeticion) {
    try {
        const resInicial = await fetch(urlPeticion);
        const dataInicial = await resInicial.json();

        if (dataInicial.estado === 200) {
            const urlDatos = dataInicial.datos;
            const resDatos = await fetch(urlDatos);
            // La lista de municipios requiere una decodificación especial
            if (urlPeticion.includes('/maestro/municipios')) {
                const buffer = await resDatos.arrayBuffer();
                const decoder = new TextDecoder('windows-1252');
                return JSON.parse(decoder.decode(buffer));
            }
            return await resDatos.json();
        } else {
            console.error(`Error con la API de AEMET (${urlPeticion}): ${dataInicial.descripcion}`);
            return null;
        }
    } catch (e) {
        console.error(`Fallo de red al intentar obtener datos de ${urlPeticion}`, e);
        return null;
    }
}

/**
 * Obtiene y cachea la lista de municipios de AEMET.
 * @returns {Promise<Array|null>} La lista de municipios.
 */
export async function getMunicipiosAemet() {
    if (municipiosCache) return municipiosCache;

    console.log("Descargando lista de municipios de AEMET por primera vez...");
    const url = `https://opendata.aemet.es/opendata/api/maestro/municipios?api_key=${API_KEY_AEMET}`;
    const municipios = await _fetchAemetData(url);

    if (municipios) {
        municipiosCache = municipios;
    }
    return municipiosCache;
}

/**
 * Adapta los datos de predicción diaria de AEMET a un formato unificado.
 */
function _adaptarDatosAemetDiaria(diasAemet) {
    const daily = {
        time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [],
        precipitation_probability_max: [], precipitation_sum: [], wind_speed_10m_max: [],
        wind_gusts_10m_max: [], apparent_temperature_max: [], uv_index_max: [],
        sunrise: [], sunset: []
    };

    diasAemet.forEach(dia => {
        daily.time.push(dia.fecha);
        daily.temperature_2m_max.push(dia.temperatura.maxima);
        daily.temperature_2m_min.push(dia.temperatura.minima);
        daily.precipitation_probability_max.push(Math.max(...dia.probPrecipitacion.map(p => p.value)));
        daily.wind_speed_10m_max.push(dia.viento.length > 0 ? Math.max(...dia.viento.map(p => p.velocidad)) : 0);
        daily.wind_gusts_10m_max.push(dia.rachaMax.length > 0 ? Math.max(...dia.rachaMax.map(p => p.value)) : 0);
        daily.apparent_temperature_max.push(dia.sensTermica?.maxima || dia.temperatura.maxima);
        daily.uv_index_max.push(dia.uvMax?.value || 0);
        daily.precipitation_sum.push(0);
        daily.sunrise.push(dia.orto || "00:00");
        daily.sunset.push(dia.ocaso || "00:00");
    });

    return daily;
}

/**
 * Adapta los datos de predicción horaria de AEMET a un formato unificado.
 */
function _adaptarDatosAemetHoraria(diasAemet) {
    const datosAdaptados = {
        time: [], weather_code: [], temperature_2m: [], apparent_temperature: [],
        precipitation_probability: [], precipitation: [], wind_speed_10m: [], wind_gusts_10m: []
    };
    const aemetToWmo = { "11": 0, "12": 1, "13": 2, "14": 3, "15": 3, "16": 3, "17": 2, "43": 51, "44": 51, "45": 61, "46": 61, "23": 51, "24": 61, "25": 61, "26": 61, "81": 45, "82": 45, "51": 95, "52": 95, "53": 95, "54": 95, "61": 95, "62": 95, "63": 95, "64": 95 };
    let currentDate = new Date();
    currentDate.setMinutes(0, 0, 0);

    diasAemet.forEach(dia => {
        const fechaBase = dia.fecha.substring(0, 10);
        for (let h = 0; h < 24; h++) {
            const horaStr = h.toString().padStart(2, '0');
            const fullDate = `${fechaBase}T${horaStr}:00:00`;
            if (new Date(fullDate) < currentDate) continue;

            const temp = dia.temperatura.find(t => t.periodo == horaStr)?.value || 0;
            const sensTerm = dia.sensTermica?.find(t => t.periodo == horaStr)?.value || temp;
            const probPrecip = dia.precipitacion.find(p => p.periodo == horaStr)?.value || 0;
            const estadoCielo = (dia.estadoCielo?.find(e => e.periodo == horaStr)?.value || "11").replace('n', '');
            const vientoData = dia.vientoAndRachaMax?.find(v => v.periodo == horaStr);
            const viento = vientoData?.velocidad[0] || 0;
            const racha = vientoData?.velocidad[1] || viento;

            datosAdaptados.time.push(fullDate);
            datosAdaptados.temperature_2m.push(parseInt(temp));
            datosAdaptados.apparent_temperature.push(parseInt(sensTerm));
            datosAdaptados.precipitation_probability.push(parseInt(probPrecip));
            datosAdaptados.precipitation.push(probPrecip > 0 ? 0.1 : 0);
            datosAdaptados.weather_code.push(aemetToWmo[estadoCielo] || 1);
            datosAdaptados.wind_speed_10m.push(parseInt(viento));
            datosAdaptados.wind_gusts_10m.push(parseInt(racha));
        }
    });
    return datosAdaptados;
}

/**
 * Obtiene y procesa los datos de predicción diaria y horaria para un municipio.
 * @param {string} idMunicipio El código del municipio (ej: '28079').
 * @returns {Promise<Object|null>} Un objeto con `nombre`, `datosDiarios` y `datosHorarios`, o null si falla.
 */
export async function getPrediccionAemet(idMunicipio) {
    if (API_KEY_AEMET === 'TU_API_KEY_AEMET') {
        alert('Por favor, añade tu API Key de AEMET en el código para que funcione.');
        return null;
    }

    const [dailyResult, hourlyResult] = await Promise.all([
        _fetchAemetData(`https://opendata.aemet.es/opendata/api/prediccion/especifica/municipio/diaria/${idMunicipio}/?api_key=${API_KEY_AEMET}`),
        _fetchAemetData(`https://opendata.aemet.es/opendata/api/prediccion/especifica/municipio/horaria/${idMunicipio}/?api_key=${API_KEY_AEMET}`)
    ]);

    if (!dailyResult && !hourlyResult) {
        return null; // Si ambas peticiones fallan, no devolvemos nada.
    }

    return {
        nombre: dailyResult?.[0]?.nombre || hourlyResult?.[0]?.nombre || "Desconocido",
        datosDiarios: dailyResult ? _adaptarDatosAemetDiaria(dailyResult[0].prediccion.dia) : null,
        datosHorarios: hourlyResult ? _adaptarDatosAemetHoraria(hourlyResult[0].prediccion.dia) : null,
    };
}