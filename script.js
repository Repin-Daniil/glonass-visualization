// Константы
const R_EARTH = 6378.137; // Радиус Земли в километрах
const ORBIT_HEIGHT = 19100; // Высота орбиты в километрах
const INCLINATION = 64.8 * Math.PI / 180; // Наклонение орбитальных плоскостей в радианах
const EARTH_AXIAL_TILT = 23.5 * Math.PI / 180; // Наклон земной оси в радианах
const SATS_PER_PLANE = 8; // 8 спутников на каждой орбитальной плоскости
const NUM_PLANES = 3; // 3 орбитальные плоскости
const NUM_SATS = SATS_PER_PLANE * NUM_PLANES; // Всего 24 спутника
const ORBIT_RADIUS = R_EARTH + ORBIT_HEIGHT; // Радиус орбиты в километрах
const PLANE_OFFSET = 120; // Разница в долготе восходящего узла между плоскостями (градусы)
const SAT_OFFSET = 45; // Угловое расстояние между спутниками на орбите (градусы)
const EARTH_AXIS_LENGTH = R_EARTH * 1.5; // Длина оси Земли (в км)

const SCALE_FACTOR = 100; // Уменьшение в сто раз

// Настройки отрисовки
let showOrbits = true;
let showEarth = true;
let showEarthAxis = true;
let rotationSpeed = 0.05;
let satSize = 3;
let earthRotation = 0;

// Инициализация WebGL
let canvas = document.getElementById("glcanvas");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
let gl = canvas.getContext("webgl");

if (!gl) {
  alert("WebGL не поддерживается вашим браузером!");
}

// ШЕЙДЕРЫ

// Вершинный шейдер для объектов
const vsSource = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aTexCoord;
uniform mat4 uMatrix;
uniform mat4 uModelMatrix;
uniform mat4 uNormalMatrix;
uniform float uPointSize;
varying vec3 vNormal;
varying vec2 vTexCoord;
varying vec3 vPosition;
void main() {
  gl_Position = uMatrix * vec4(aPosition, 1.0);
  vNormal = (uNormalMatrix * vec4(aNormal, 0.0)).xyz;
  vTexCoord = aTexCoord;
  vPosition = (uModelMatrix * vec4(aPosition, 1.0)).xyz;
  gl_PointSize = uPointSize; // Использование размера из uniform
}
`;

// Фрагментный шейдер для объектов
const fsSource = `
precision mediump float;
uniform vec4 uColor;
uniform sampler2D uTexture;
uniform int uUseTexture;
uniform vec3 uLightDirection;
varying vec3 vNormal;
varying vec2 vTexCoord;
varying vec3 vPosition;

void main() {
  vec4 color = uColor;
  if (uUseTexture == 1) {
    color = texture2D(uTexture, vTexCoord);
  }
  
  // Усиленное освещение
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(uLightDirection);
  float ambient = 0.5; // Добавим ambient освещение
  float diffuse = max(dot(normal, lightDir), 0.0);
  float lightIntensity = ambient + (1.0 - ambient) * diffuse;
  
  gl_FragColor = vec4(color.rgb * lightIntensity * 1.5, color.a); // Умножаем на 1.5 для большей яркости
}
`;

// Компиляция шейдеров
function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    alert('Ошибка при компиляции шейдера: ' + gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

const vertexShader = compileShader(gl.VERTEX_SHADER, vsSource);
const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fsSource);

const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);

if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  alert('Ошибка при компоновке программы: ' + gl.getProgramInfoLog(program));
}

gl.useProgram(program);

// Получение атрибутов и униформ
const aPosition = gl.getAttribLocation(program, "aPosition");
const aNormal = gl.getAttribLocation(program, "aNormal");
const aTexCoord = gl.getAttribLocation(program, "aTexCoord");
const uMatrix = gl.getUniformLocation(program, "uMatrix");
const uModelMatrix = gl.getUniformLocation(program, "uModelMatrix");
const uNormalMatrix = gl.getUniformLocation(program, "uNormalMatrix");
const uColor = gl.getUniformLocation(program, "uColor");
const uTexture = gl.getUniformLocation(program, "uTexture");
const uUseTexture = gl.getUniformLocation(program, "uUseTexture");
const uLightDirection = gl.getUniformLocation(program, "uLightDirection");
const uPointSize = gl.getUniformLocation(program, "uPointSize");

// Создание буферов для объектов
const satBuffer = gl.createBuffer();
const earthVertexBuffer = gl.createBuffer();
const earthIndexBuffer = gl.createBuffer();
const earthNormalBuffer = gl.createBuffer();
const earthTexCoordBuffer = gl.createBuffer();
const orbitBuffer = gl.createBuffer();
const axisBuffer = gl.createBuffer();

// Создание текстуры Земли
const earthTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, earthTexture);
// Временная текстура 1x1 пиксель, пока настоящая не загрузится
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
              new Uint8Array([0, 0, 255, 255]));

// Загрузка текстуры Земли
const earthImage = new Image();
earthImage.crossOrigin = "anonymous";
earthImage.onload = function() {
  gl.bindTexture(gl.TEXTURE_2D, earthTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, earthImage);
  gl.generateMipmap(gl.TEXTURE_2D);
};

earthImage.src = 'https://raw.githack.com/zdenekhynek/webgl-globe/master/earth_atmos_2048.jpg';

// Создание данных для земной оси
function createEarthAxis() {
  const length = EARTH_AXIS_LENGTH / SCALE_FACTOR;
  // Ось всегда идет от -y к +y (с юга на север)
  return new Float32Array([
    0, -length, 0,  // Южный полюс
    0, length, 0    // Северный полюс
  ]);
}

// Создаем данные для земной оси
const axisData = createEarthAxis();
gl.bindBuffer(gl.ARRAY_BUFFER, axisBuffer);
gl.bufferData(gl.ARRAY_BUFFER, axisData, gl.STATIC_DRAW);

// Создание сферы для Земли
function createSphere(radius, latBands, longBands) {
  const vertices = [];
  const normals = [];
  const texCoords = [];
  const indices = [];
  
  for (let lat = 0; lat <= latBands; lat++) {
    const theta = lat * Math.PI / latBands;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    
    for (let lon = 0; lon <= longBands; lon++) {
      const phi = lon * 2 * Math.PI / longBands;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      
      const x = cosPhi * sinTheta;
      const y = cosTheta;
      const z = sinPhi * sinTheta;
      const u = 1 - (lon / longBands);
    
      const v = lat / latBands;
      
      normals.push(x, y, z);
      texCoords.push(u, v);
      vertices.push(radius * x / SCALE_FACTOR, radius * y / SCALE_FACTOR, radius * z / SCALE_FACTOR);
    }
  }
  
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < longBands; lon++) {
      const first = (lat * (longBands + 1)) + lon;
      const second = first + longBands + 1;
      
      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }
  
  return {
    vertices: new Float32Array(vertices),
    normals: new Float32Array(normals),
    texCoords: new Float32Array(texCoords),
    indices: new Uint16Array(indices)
  };
}

const earthSphere = createSphere(R_EARTH, 50, 50);

// Загрузка данных Земли в буферы
gl.bindBuffer(gl.ARRAY_BUFFER, earthVertexBuffer);
gl.bufferData(gl.ARRAY_BUFFER, earthSphere.vertices, gl.STATIC_DRAW);

gl.bindBuffer(gl.ARRAY_BUFFER, earthNormalBuffer);
gl.bufferData(gl.ARRAY_BUFFER, earthSphere.normals, gl.STATIC_DRAW);

gl.bindBuffer(gl.ARRAY_BUFFER, earthTexCoordBuffer);
gl.bufferData(gl.ARRAY_BUFFER, earthSphere.texCoords, gl.STATIC_DRAW);

gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, earthIndexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, earthSphere.indices, gl.STATIC_DRAW);

// Создание орбит с учетом их реального положения
function createOrbits() {
  const orbitPoints = [];
  const numPointsPerOrbit = 200;
  
  for (let plane = 0; plane < NUM_PLANES; plane++) {
    const Ω = (plane * PLANE_OFFSET) * Math.PI / 180; // Долгота восходящего узла
    
    for (let i = 0; i <= numPointsPerOrbit; i++) {
      const angle = (i / numPointsPerOrbit) * 2 * Math.PI;
      const r = ORBIT_RADIUS / SCALE_FACTOR;
      const cosO = Math.cos(Ω), sinO = Math.sin(Ω);
      const cosu = Math.cos(angle), sinu = Math.sin(angle);
      const cosi = Math.cos(INCLINATION), sini = Math.sin(INCLINATION);
      
      // Формулы перевода из кеплеровских в декартовы координаты
      const x = r * (cosO * cosu - sinO * sinu * cosi);
      const y = r * (sinu * sini);
      const z = r * (sinO * cosu + cosO * sinu * cosi);
      
      orbitPoints.push(x, y, z);
    }
  }
  
  return new Float32Array(orbitPoints);
}

// Загрузка орбит в буферы
const orbits = createOrbits();
gl.bindBuffer(gl.ARRAY_BUFFER, orbitBuffer);
gl.bufferData(gl.ARRAY_BUFFER, orbits, gl.STATIC_DRAW);

// Расчет положения спутников
function computeSatellites(time) {
  const satPositions = [];
  
  for (let plane = 0; plane < NUM_PLANES; plane++) {
    const Ω = (plane * PLANE_OFFSET) * Math.PI / 180; // Долгота восходящего узла (0°, 120°, 240°)
    
    for (let i = 0; i < SATS_PER_PLANE; i++) {
      // Аргумент широты с учетом времени и настраиваемой скорости вращения
      const arg_lat = ((i * SAT_OFFSET + time * rotationSpeed) % 360) * Math.PI / 180;
      const r = ORBIT_RADIUS / SCALE_FACTOR;
      const cosO = Math.cos(Ω), sinO = Math.sin(Ω);
      const cosu = Math.cos(arg_lat), sinu = Math.sin(arg_lat);
      const cosi = Math.cos(INCLINATION), sini = Math.sin(INCLINATION);
      
      // Формулы перевода из кеплеровских в декартовы координаты
      const x = r * (cosO * cosu - sinO * sinu * cosi);
      const y = r * (sinu * sini);
      const z = r * (sinO * cosu + cosO * sinu * cosi);
      
      satPositions.push(x, y, z);
    }
  }
  
  return new Float32Array(satPositions);
}

// Управление камерой
let cameraAngleX = 0;
let cameraAngleY = 0;
let cameraDistance = 300; // Расстояние от камеры до центра
let dragging = false;
let lastX, lastY;
let zoomLevel = 1;

// Обработчики событий для управления камерой
canvas.addEventListener("mousedown", e => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});

canvas.addEventListener("mouseup", () => dragging = false);
canvas.addEventListener("mouseleave", () => dragging = false);

canvas.addEventListener("mousemove", e => {
  if (dragging) {
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    cameraAngleY += dx * 0.005;
    cameraAngleX = Math.max(-Math.PI/2, Math.min(Math.PI/2, cameraAngleX + dy * 0.005));
    lastX = e.clientX;
    lastY = e.clientY;
  }
});

canvas.addEventListener("wheel", e => {
  e.preventDefault();
  zoomLevel *= e.deltaY > 0 ? 1.1 : 0.9;
  zoomLevel = Math.max(0.1, Math.min(5, zoomLevel));
  cameraDistance = 300 * zoomLevel;
});

// Управление отображением элементов
document.getElementById("showOrbits").addEventListener("change", function() {
  showOrbits = this.checked;
});

document.getElementById("showEarthAxis").addEventListener("change", function() {
  showEarthAxis = this.checked;
});

document.getElementById("resetCamera").addEventListener("click", function() {
  cameraAngleX = 0;
  cameraAngleY = 0;
  zoomLevel = 1;
  cameraDistance = 300;
});

// Обработчики для элементов управления
document.getElementById("rotationSpeed").addEventListener("input", function() {
  rotationSpeed = parseFloat(this.value);
  document.getElementById("speedValue").textContent = rotationSpeed.toFixed(2);
});

document.getElementById("satSize").addEventListener("input", function() {
  satSize = parseInt(this.value);
  document.getElementById("sizeValue").textContent = satSize;
});

// Обработка изменения размера окна
window.addEventListener('resize', function() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
});

// Вспомогательные функции для матриц
function perspective(fov, aspect, near, far) {
  const f = 1.0 / Math.tan(fov / 2), nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0
  ];
}

function multiply(a, b) {
  const out = new Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      out[i * 4 + j] = a[0 * 4 + j] * b[i * 4 + 0] +
                       a[1 * 4 + j] * b[i * 4 + 1] +
                       a[2 * 4 + j] * b[i * 4 + 2] +
                       a[3 * 4 + j] * b[i * 4 + 3];
  return out;
}

function lookAt(tx, ty, tz, rx, ry) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  return [
    cy, 0, -sy, 0,
    sx * sy, cx, sx * cy, 0,
    cx * sy, -sx, cx * cy, 0,
    -tx, -ty, -tz, 1
  ];
}

function identity() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
}

function rotateY(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    c, 0, s, 0,
    0, 1, 0, 0,
    -s, 0, c, 0,
    0, 0, 0, 1
  ];
}

function rotateX(angleRad) {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [
    1, 0, 0, 0,
    0, c, -s, 0,
    0, s, c, 0,
    0, 0, 0, 1
  ];
}

function rotateZ(angleRad) {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [
    c, -s, 0, 0,
    s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
}

function transpose(m) {
  return [
    m[0], m[4], m[8], m[12],
    m[1], m[5], m[9], m[13],
    m[2], m[6], m[10], m[14],
    m[3], m[7], m[11], m[15]
  ];
}

function inverse(m) {
  // Упрощенная версия для матриц трансформации
  const r = identity();
  
  // Копируем вращательную часть (транспонируя)
  r[0] = m[0]; r[1] = m[4]; r[2] = m[8];
  r[4] = m[1]; r[5] = m[5]; r[6] = m[9];
  r[8] = m[2]; r[9] = m[6]; r[10] = m[10];
  
  // Вычисляем новое положение
  r[12] = -(m[0]*m[12] + m[1]*m[13] + m[2]*m[14]);
  r[13] = -(m[4]*m[12] + m[5]*m[13] + m[6]*m[14]);
  r[14] = -(m[8]*m[12] + m[9]*m[13] + m[10]*m[14]);
  
  return r;
}

// Основной цикл рендеринга
function render(time) {
  time *= 0.001; // Конвертация в секунды
  
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  
  earthRotation += rotationSpeed / 50;

  // Устанавливаем подходящие значения для near и far плоскостей
  const aspect = canvas.width / canvas.height;
  const proj = perspective(Math.PI / 4, aspect, 1, 2000);
  const view = lookAt(0, 0, cameraDistance, cameraAngleX, cameraAngleY);
  const viewProj = multiply(proj, view);
  
  // Направление света (от Солнца)
  gl.uniform3f(uLightDirection, 1, 0.5, 0.3);
  
  // Отрисовка Земли
  if (showEarth) {
    // Создаем матрицу наклона оси земли
    const tiltMatrix = rotateZ(EARTH_AXIAL_TILT);
    // Создаем матрицу вращения вокруг оси
    const spinMatrix = rotateY(earthRotation);
    // Комбинируем преобразования: сначала наклон, потом вращение
    const earthModelMatrix = multiply(tiltMatrix, spinMatrix);

    gl.uniformMatrix4fv(uModelMatrix, false, earthModelMatrix);
    gl.uniformMatrix4fv(uMatrix, false, multiply(viewProj, earthModelMatrix));
    gl.uniformMatrix4fv(uNormalMatrix, false, inverse(transpose(earthModelMatrix)));

    gl.bindBuffer(gl.ARRAY_BUFFER, earthVertexBuffer);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aPosition);

    gl.bindBuffer(gl.ARRAY_BUFFER, earthNormalBuffer);
    gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aNormal);

    gl.bindBuffer(gl.ARRAY_BUFFER, earthTexCoordBuffer);
    gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aTexCoord);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, earthTexture);
    gl.uniform1i(uTexture, 0);
    gl.uniform1i(uUseTexture, 1);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, earthIndexBuffer);
    gl.drawElements(gl.TRIANGLES, earthSphere.indices.length, gl.UNSIGNED_SHORT, 0);
  }

  // Отключаем текстуру для остальных объектов
  gl.uniform1i(uUseTexture, 0);
  
  // Отображаем земную ось
  if (showEarthAxis) {
    // Применяем к оси тот же наклон что и к Земле
    const axisModelMatrix = rotateZ(EARTH_AXIAL_TILT);
    
    gl.uniformMatrix4fv(uModelMatrix, false, axisModelMatrix);
    gl.uniformMatrix4fv(uMatrix, false, multiply(viewProj, axisModelMatrix));
    
    gl.bindBuffer(gl.ARRAY_BUFFER, axisBuffer);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aPosition);
    gl.disableVertexAttribArray(aNormal);
    gl.disableVertexAttribArray(aTexCoord);
    
    gl.uniform4f(uColor, 1, 1, 1, 1); // Белый цвет для оси
    gl.uniform1f(uPointSize, 1.0); // Сбрасываем размер точек
    gl.drawArrays(gl.LINES, 0, 2); // Рисуем одну линию из двух точек
  }
  
  // Отрисовка орбит
  if (showOrbits) {
    gl.uniformMatrix4fv(uModelMatrix, false, identity());
    gl.uniformMatrix4fv(uMatrix, false, viewProj);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, orbitBuffer);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aPosition);
    gl.disableVertexAttribArray(aNormal);
    gl.disableVertexAttribArray(aTexCoord);
    
    for (let i = 0; i < NUM_PLANES; i++) {
      // Яркие цвета для разных орбитальных плоскостей
      if (i === 0) {
        gl.uniform4f(uColor, 0.2, 0.7, 1, 1); // Синий - первая плоскость
      } else if (i === 1) {
        gl.uniform4f(uColor, 0.2, 1, 0, 1); // Зеленый - вторая плоскость
      } else {
        gl.uniform4f(uColor, 1, 0.2, 0.2, 1); // Красный - третья плоскость
      }
      
      gl.drawArrays(gl.LINE_STRIP, i * 201, 201); // 201 точка на орбиту
    }
  }
  
  // Отрисовка спутников
  const positions = computeSatellites(time * 30);
  gl.bindBuffer(gl.ARRAY_BUFFER, satBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPosition);
  gl.disableVertexAttribArray(aNormal);
  gl.disableVertexAttribArray(aTexCoord);

  // Устанавливаем размер точек из ползунка
  gl.uniform1f(uPointSize, satSize * 2); // Умножаем на 2 для более заметных спутников

  for (let i = 0; i < NUM_PLANES; i++) {
    // Яркие цвета для спутников соответствующих орбит
    if (i === 0) {
      gl.uniform4f(uColor, 0.2, 0.7, 1, 1); // Синий - первая плоскость
    } else if (i === 1) {
      gl.uniform4f(uColor, 0.2, 1, 0, 1); // Зеленый - вторая плоскость
    } else {
      gl.uniform4f(uColor, 1, 0.2, 0.2, 1); // Красный - третья плоскость
    }
    
    gl.drawArrays(gl.POINTS, i * SATS_PER_PLANE, SATS_PER_PLANE);
  }

  // Обновление информации
  document.getElementById("info").innerHTML = `
    <h3>ГЛОНАСС Визуализация</h3>
    <p>Спутников: ${NUM_SATS}</p>
    <p>Орбитальных плоскостей: ${NUM_PLANES}</p>
    <p>Наклонение: ${(INCLINATION * 180 / Math.PI).toFixed(1)}°</p>
    <p>Наклон земной оси: ${(EARTH_AXIAL_TILT * 180 / Math.PI).toFixed(1)}°</p>
    <p>Высота орбиты: ${(ORBIT_HEIGHT).toFixed(0)} км</p>
    <p>Скорость вращения: ${rotationSpeed.toFixed(2)}</p>
    <p>Масштаб: ${zoomLevel.toFixed(2)}x</p>
  `;

  requestAnimationFrame(render);
}
    
requestAnimationFrame(render);
