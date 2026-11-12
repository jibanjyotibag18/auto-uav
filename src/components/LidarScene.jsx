import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export default function LidarScene({ points = [], clearVersion = 0 }) {
  const hostRef = useRef(null)
  const pointsRef = useRef(points)
  const clearRef = useRef(clearVersion)
  const clearedPointsRef = useRef(null)
  pointsRef.current = points
  clearRef.current = clearVersion

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0b111c')
    scene.fog = new THREE.Fog('#0b111c', 18, 42)
    const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 100)
    camera.position.set(8, 7, 10)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(host.clientWidth, host.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 1.6))
    const directional = new THREE.DirectionalLight(0x9ec9ff, 2.2)
    directional.position.set(4, 8, 6)
    scene.add(directional)
    const grid = new THREE.GridHelper(20, 20, 0x29405a, 0x18283a)
    grid.position.y = -0.02
    scene.add(grid)
    const axes = new THREE.AxesHelper(1.5)
    scene.add(axes)
    const drone = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.65, 4),
      new THREE.MeshStandardMaterial({ color: '#58b6ff', emissive: '#102d48', roughness: 0.55 }),
    )
    drone.rotation.x = Math.PI / 2
    drone.position.y = 0.12
    scene.add(drone)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0.8, 0)
    let cloud = null
    const renderPoints = () => {
      if (cloud) {
        scene.remove(cloud)
        cloud.geometry.dispose()
        cloud.material.dispose()
      }
      const sourcePoints = clearRef.current && pointsRef.current === clearedPointsRef.current ? [] : pointsRef.current
      const current = sourcePoints.filter((point) => point && typeof point === 'object' &&
        Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)) && Number.isFinite(Number(point.z)),
      )
      const positions = new Float32Array(current.length * 3)
      const colors = new Float32Array(current.length * 3)
      current.forEach((point, index) => {
        positions[index * 3] = Number(point.x)
        positions[index * 3 + 1] = Number(point.y)
        positions[index * 3 + 2] = Number(point.z)
        const color = point.obstacle ? new THREE.Color('#ff5c6c') : new THREE.Color('#4ee1a0')
        colors[index * 3] = color.r
        colors[index * 3 + 1] = color.g
        colors[index * 3 + 2] = color.b
      })
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      cloud = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.12, vertexColors: true, sizeAttenuation: true }))
      scene.add(cloud)
    }

    renderPoints()
    let previousPoints = points
    let previousClearVersion = clearVersion
    let animation
    const animate = () => {
      animation = requestAnimationFrame(animate)
      if (pointsRef.current !== previousPoints || clearRef.current !== previousClearVersion) {
        if (clearRef.current !== previousClearVersion) clearedPointsRef.current = pointsRef.current
        previousPoints = pointsRef.current
        previousClearVersion = clearRef.current
        renderPoints()
      }
      controls.update()
      renderer.render(scene, camera)
    }
    animate()
    const resize = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      if (!width || !height) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    return () => {
      cancelAnimationFrame(animation)
      observer.disconnect()
      controls.dispose()
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose()
        if (object.material) {
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose())
          else object.material.dispose()
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div ref={hostRef} className="lidar-canvas" aria-label="Interactive three-dimensional LiDAR point cloud" />
}
