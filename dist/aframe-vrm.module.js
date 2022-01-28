// src/vrm/lookat.ts
var VRMLookAt = class {
  constructor(initCtx) {
    this.target = null;
    this.angleLimit = 60 * Math.PI / 180;
    this._identQ = new THREE.Quaternion();
    this._zV = new THREE.Vector3(0, 0, -1);
    this._tmpQ0 = new THREE.Quaternion();
    this._tmpV0 = new THREE.Vector3();
    this._bone = initCtx.nodes[initCtx.vrm.firstPerson.firstPersonBone];
  }
  update(t) {
    let target = this.target, bone = this._bone;
    if (target == null || bone == null)
      return;
    let targetDirection = bone.worldToLocal(this._tmpV0.setFromMatrixPosition(target.matrixWorld)).normalize(), rot = this._tmpQ0.setFromUnitVectors(this._zV, targetDirection), boneLimit = this.angleLimit, speedFactor = 0.08, angle = 2 * Math.acos(rot.w);
    angle > boneLimit * 1.5 ? (rot = this._identQ, speedFactor = 0.04) : angle > boneLimit && rot.setFromAxisAngle(this._tmpV0.set(rot.x, rot.y, rot.z).normalize(), boneLimit), bone.quaternion.slerp(rot, speedFactor);
  }
};

// src/vrm/blendshape.ts
var VRMBlendShapeUtil = class {
  constructor(avatar) {
    this._currentShape = {};
    this._avatar = avatar;
  }
  setBlendShapeWeight(name, value) {
    this._currentShape[name] = value, value == 0 && delete this._currentShape[name], this._updateBlendShape();
  }
  getBlendShapeWeight(name) {
    return this._currentShape[name] || 0;
  }
  resetBlendShape() {
    this._currentShape = {}, this._updateBlendShape();
  }
  startBlink(blinkInterval) {
    this.animatedMorph || (this.animatedMorph = {
      name: "BLINK",
      times: [0, blinkInterval - 0.2, blinkInterval - 0.1, blinkInterval],
      values: [0, 0, 1, 0]
    }, this._updateBlendShape());
  }
  stopBlink() {
    this.animatedMorph = null, this._updateBlendShape();
  }
  _updateBlendShape() {
    let addWeights = (data, name, weights) => {
      let blend = this._avatar.blendShapes[name];
      blend && blend.binds.forEach((bind) => {
        let tname = bind.target.name, values = data[tname] || (data[tname] = new Array(bind.target.morphTargetInfluences.length * weights.length).fill(0));
        for (let t = 0; t < weights.length; t++) {
          let i = t * bind.target.morphTargetInfluences.length + bind.index;
          values[i] += Math.max(bind.weight * weights[t], values[i]);
        }
      });
    }, times = [0], trackdata = {};
    this.animatedMorph && (times = this.animatedMorph.times, addWeights(trackdata, this.animatedMorph.name, this.animatedMorph.values));
    for (let [name, value] of Object.entries(this._currentShape))
      this._avatar.blendShapes[name] && addWeights(trackdata, name, new Array(times.length).fill(value));
    let tracks = Object.entries(trackdata).map(([tname, values]) => new THREE.NumberKeyframeTrack(tname + ".morphTargetInfluences", times, values)), nextAction = null;
    if (tracks.length > 0) {
      let clip = new THREE.AnimationClip("morph", void 0, tracks);
      nextAction = this._avatar.mixer.clipAction(clip).setEffectiveWeight(1).play();
    }
    this.morphAction && this.morphAction.stop(), this.morphAction = nextAction;
  }
};

// src/vrm/firstperson.ts
var FirstPersonMeshUtil = class {
  constructor(initCtx) {
    this._firstPersonBone = initCtx.nodes[initCtx.vrm.firstPerson.firstPersonBone], this._annotatedMeshes = initCtx.vrm.firstPerson.meshAnnotations.map((ma) => ({ flag: ma.firstPersonFlag, mesh: initCtx.meshes[ma.mesh] }));
  }
  setFirstPerson(firstPerson) {
    this._annotatedMeshes.forEach((a) => {
      a.flag == "ThirdPersonOnly" ? a.mesh.visible = !firstPerson : a.flag == "FirstPersonOnly" ? a.mesh.visible = firstPerson : a.flag == "Auto" && this._firstPersonBone && (firstPerson ? this._genFirstPersonMesh(a.mesh) : this._resetFirstPersonMesh(a.mesh));
    });
  }
  _genFirstPersonMesh(mesh) {
    if (mesh.children.forEach((c) => this._genFirstPersonMesh(c)), !mesh.isSkinnedMesh)
      return;
    let firstPersonBones = {};
    this._firstPersonBone.traverse((b) => {
      firstPersonBones[b.uuid] = !0;
    });
    let skeletonBones = mesh.skeleton.bones, skinIndex = mesh.geometry.attributes.skinIndex, skinWeight = mesh.geometry.attributes.skinWeight, index = mesh.geometry.index, vertexErase = [], vcount = 0, fcount = 0;
    for (let i = 0; i < skinIndex.array.length; i++) {
      let b = skinIndex.array[i];
      skinWeight.array[i] > 0 && firstPersonBones[skeletonBones[b].uuid] && (vertexErase[i / skinIndex.itemSize | 0] || (vcount++, vertexErase[i / skinIndex.itemSize | 0] = !0));
    }
    let trinagleErase = [];
    for (let i = 0; i < index.count; i++)
      vertexErase[index.array[i]] && !trinagleErase[i / 3 | 0] && (trinagleErase[i / 3 | 0] = !0, fcount++);
    if (fcount != 0 && fcount * 3 == index.count) {
      mesh.visible = !1;
      return;
    }
  }
  _resetFirstPersonMesh(mesh) {
    mesh.children.forEach((c) => this._resetFirstPersonMesh(c)), mesh.visible = !0;
  }
};

// src/vrm/avatar.ts
var VRMLoader = class {
  constructor(gltfLoader) {
    this.gltfLoader = gltfLoader || new THREE.GLTFLoader(THREE.DefaultLoadingManager);
  }
  async load(url, moduleSpecs = []) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(url, async (gltf) => {
        resolve(await new VRMAvatar(gltf).init(gltf, moduleSpecs));
      }, void 0, reject);
    });
  }
}, VRMAvatar = class {
  constructor(gltf) {
    this.bones = {};
    this.blendShapes = {};
    this.modules = {};
    this.meta = {};
    this.firstPersonBone = null;
    this._firstPersonMeshUtil = null;
    this.boneConstraints = {
      head: { type: "ball", limit: 60 * Math.PI / 180, twistAxis: new THREE.Vector3(0, 1, 0), twistLimit: 60 * Math.PI / 180 },
      neck: { type: "ball", limit: 30 * Math.PI / 180, twistAxis: new THREE.Vector3(0, 1, 0), twistLimit: 10 * Math.PI / 180 },
      leftUpperLeg: { type: "ball", limit: 170 * Math.PI / 180, twistAxis: new THREE.Vector3(0, -1, 0), twistLimit: Math.PI / 2 },
      rightUpperLeg: { type: "ball", limit: 170 * Math.PI / 180, twistAxis: new THREE.Vector3(0, -1, 0), twistLimit: Math.PI / 2 },
      leftLowerLeg: { type: "hinge", axis: new THREE.Vector3(1, 0, 0), min: -170 * Math.PI / 180, max: 0 * Math.PI / 180 },
      rightLowerLeg: { type: "hinge", axis: new THREE.Vector3(1, 0, 0), min: -170 * Math.PI / 180, max: 0 * Math.PI / 180 }
    };
    this.model = gltf.scene, this.mixer = new THREE.AnimationMixer(this.model), this.isVRM = (gltf.userData.gltfExtensions || {}).VRM != null, this.animations = gltf.animations || [], this._blendShapeUtil = new VRMBlendShapeUtil(this);
  }
  async init(gltf, moduleSpecs) {
    if (!this.isVRM)
      return this;
    let vrmExt = gltf.userData.gltfExtensions.VRM, bones = this.bones, nodes = await gltf.parser.getDependencies("node"), meshes = await gltf.parser.getDependencies("mesh"), initCtx = { nodes, meshes, vrm: vrmExt, gltf };
    this.meta = vrmExt.meta, Object.values(vrmExt.humanoid.humanBones).forEach((humanBone) => {
      bones[humanBone.bone] = nodes[humanBone.node];
    }), vrmExt.firstPerson && (vrmExt.firstPerson.firstPersonBone && (this.firstPersonBone = nodes[vrmExt.firstPerson.firstPersonBone], this.modules.lookat = new VRMLookAt(initCtx)), vrmExt.firstPerson.meshAnnotations && (this._firstPersonMeshUtil = new FirstPersonMeshUtil(initCtx))), this.model.skeleton = new THREE.Skeleton(Object.values(bones)), this._fixBoundingBox(), vrmExt.blendShapeMaster && this._initBlendShapes(initCtx);
    for (let spec of moduleSpecs) {
      let mod = spec.instantiate(this, initCtx);
      mod && (this.modules[spec.name] = mod);
    }
    return this;
  }
  _initBlendShapes(ctx) {
    this.blendShapes = (ctx.vrm.blendShapeMaster.blendShapeGroups || []).reduce((blendShapes, bg) => {
      let binds = bg.binds.flatMap((bind) => {
        let meshObj = ctx.meshes[bind.mesh];
        return (meshObj.isSkinnedMesh ? [meshObj] : meshObj.children.filter((obj) => obj.isSkinnedMesh)).map((obj) => ({ target: obj, index: bind.index, weight: bind.weight / 100 }));
      });
      return blendShapes[(bg.presetName || bg.name).toUpperCase()] = { name: bg.name, binds }, blendShapes;
    }, {});
  }
  _fixBoundingBox() {
    let bones = this.bones;
    if (!bones.hips)
      return;
    let tmpV = new THREE.Vector3(), center = bones.hips.getWorldPosition(tmpV).clone();
    this.model.traverse((obj) => {
      let mesh = obj;
      if (mesh.isSkinnedMesh) {
        let pos = mesh.getWorldPosition(tmpV).sub(center).multiplyScalar(-1), r = pos.clone().sub(mesh.geometry.boundingSphere.center).length() + mesh.geometry.boundingSphere.radius;
        mesh.geometry.boundingSphere.center.copy(pos), mesh.geometry.boundingSphere.radius = r, mesh.geometry.boundingBox.min.set(pos.x - r, pos.y - r, pos.z - r), mesh.geometry.boundingBox.max.set(pos.x + r, pos.y + r, pos.z + r);
      }
    });
  }
  update(timeDelta) {
    this.mixer.update(timeDelta);
    for (let m of Object.values(this.modules))
      m.update(timeDelta);
  }
  setModule(name, module) {
    this.removeModule(name), this.modules[name] = module;
  }
  removeModule(name) {
    let module = this.modules[name];
    module && module.dispose && module.dispose(), delete this.modules[name];
  }
  dispose() {
    for (let m of Object.keys(this.modules))
      this.removeModule(m);
    this.model.traverse((obj) => {
      let mesh = obj;
      mesh.isMesh && (mesh.geometry.dispose(), mesh.material.map?.dispose()), obj.skeleton && obj.skeleton.dispose();
    });
  }
  get lookAtTarget() {
    let lookat = this.modules.lookat;
    return lookat ? lookat.target : null;
  }
  set lookAtTarget(v) {
    let lookat = this.modules.lookat;
    lookat && (lookat.target = v);
  }
  setBlendShapeWeight(name, value) {
    this._blendShapeUtil.setBlendShapeWeight(name, value);
  }
  getBlendShapeWeight(name) {
    return this._blendShapeUtil.getBlendShapeWeight(name);
  }
  resetBlendShape() {
    this._blendShapeUtil.resetBlendShape();
  }
  startBlink(blinkInterval) {
    this._blendShapeUtil.startBlink(blinkInterval);
  }
  stopBlink() {
    this._blendShapeUtil.stopBlink();
  }
  getPose(exportMorph) {
    let poseData = {
      bones: Object.keys(this.bones).map((name) => ({ name, q: this.bones[name].quaternion.toArray() }))
    };
    return exportMorph && (poseData.blendShape = Object.keys(this.blendShapes).map((name) => ({ name, value: this.getBlendShapeWeight(name) }))), poseData;
  }
  setPose(pose) {
    if (pose.bones)
      for (let boneParam of pose.bones)
        this.bones[boneParam.name] && this.bones[boneParam.name].quaternion.fromArray(boneParam.q);
    if (pose.blendShape)
      for (let morph of pose.blendShape)
        this.setBlendShapeWeight(morph.name, morph.value);
  }
  restPose() {
    for (let b of Object.values(this.bones))
      b.quaternion.set(0, 0, 0, 1);
  }
  setFirstPerson(firstPerson) {
    this._firstPersonMeshUtil && this._firstPersonMeshUtil.setFirstPerson(firstPerson);
  }
};

// src/utils/physics-cannon.ts
var VRMPhysicsCannonJS = class {
  constructor(initctx) {
    this.collisionGroup = 2;
    this.enable = !1;
    this.binds = [];
    this.fixedBinds = [];
    this.bodies = [];
    this.constraints = [];
    this._tmpQ0 = new THREE.Quaternion();
    this._tmpV0 = new THREE.Vector3();
    this._tmpV1 = new THREE.Vector3();
    this.world = null;
    this.internalWorld = !1;
    this.springBoneSystem = this._springBoneSystem(), this._init(initctx);
  }
  _init(initctx) {
    if (!initctx.vrm.secondaryAnimation)
      return;
    let nodes = initctx.nodes, secondaryAnimation = initctx.vrm.secondaryAnimation, allColliderGroupsMask = 0, colliderMarginFactor = 0.9;
    (secondaryAnimation.colliderGroups || []).forEach((cc, i) => {
      let node = nodes[cc.node];
      for (let collider of cc.colliders) {
        let body = new CANNON.Body({ mass: 0, collisionFilterGroup: 1 << this.collisionGroup + i + 1, collisionFilterMask: -1 });
        body.addShape(new CANNON.Sphere(collider.radius * colliderMarginFactor), collider.offset), this.bodies.push(body), this.fixedBinds.push([node, body]), allColliderGroupsMask |= body.collisionFilterGroup;
      }
    });
    for (let bg of secondaryAnimation.boneGroups || []) {
      let gravity = new CANNON.Vec3().copy(bg.gravityDir || { x: 0, y: -1, z: 0 }).scale(bg.gravityPower || 0), radius = bg.hitRadius || 0.05, collisionFilterMask = ~(this.collisionGroup | allColliderGroupsMask);
      for (let g of bg.colliderGroups || [])
        collisionFilterMask |= 1 << this.collisionGroup + g + 1;
      for (let b of bg.bones) {
        let root = new CANNON.Body({ mass: 0, collisionFilterGroup: 0, collisionFilterMask: 0 });
        root.position.copy(nodes[b].parent.getWorldPosition(this._tmpV0)), this.bodies.push(root), this.fixedBinds.push([nodes[b].parent, root]);
        let add = (parentBody, node) => {
          let c = node.getWorldPosition(this._tmpV0), wpos = c.clone(), n = node.children.length + 1;
          node.children.length > 0 ? node.children.forEach((n2) => {
            c.add(n2.getWorldPosition(this._tmpV1));
          }) : (c.add(node.parent.getWorldPosition(this._tmpV1).sub(c).normalize().multiplyScalar(-0.1).add(c)), n = 2), c.multiplyScalar(1 / n);
          let body = new CANNON.Body({
            mass: 0.5,
            linearDamping: Math.max(bg.dragForce || 0, 1e-4),
            angularDamping: Math.max(bg.dragForce || 0, 1e-4),
            collisionFilterGroup: this.collisionGroup,
            collisionFilterMask,
            position: new CANNON.Vec3().copy(c)
          });
          body.addShape(new CANNON.Sphere(radius)), this.bodies.push(body);
          let o = new CANNON.Vec3().copy(this._tmpV1.copy(wpos).sub(c)), d = new CANNON.Vec3().copy(wpos.sub(parentBody.position)), joint = new CANNON.PointToPointConstraint(body, o, parentBody, d);
          this.constraints.push(joint), this.binds.push([node, body]), this.springBoneSystem.objects.push({ body, parentBody, force: gravity, boneGroup: bg, size: radius }), node.children.forEach((n2) => n2.isBone && add(body, n2));
        };
        add(root, nodes[b]);
      }
    }
  }
  _springBoneSystem() {
    let _q0 = new CANNON.Quaternion(), _q12 = new CANNON.Quaternion(), _v02 = new CANNON.Vec3();
    return {
      world: null,
      objects: [],
      update() {
        let g = this.world.gravity, dt = this.world.dt, avlimit = 0.1;
        for (let b of this.objects) {
          let body = b.body, parent = b.parentBody, f = body.force, m = body.mass, g2 = b.force;
          f.x += m * (-g.x + g2.x), f.y += m * (-g.y + g2.y), f.z += m * (-g.z + g2.z);
          let av = body.angularVelocity.length();
          av > avlimit && body.angularVelocity.scale(avlimit / av, body.angularVelocity);
          let stiffness = b.boneGroup.stiffiness, approxInertia = b.size * b.size * m * 1600, rot = body.quaternion.mult(parent.quaternion.inverse(_q0), _q12), [axis, angle] = rot.toAxisAngle(_v02);
          angle = angle - Math.PI * 2 * Math.floor((angle + Math.PI) / (Math.PI * 2));
          let tf = angle * stiffness;
          Math.abs(tf) > Math.abs(angle / dt / dt * 25e-5) && (tf = angle / dt / dt * 25e-5);
          let af = axis.scale(-tf * approxInertia, axis);
          body.torque.vadd(af, body.torque);
        }
      }
    };
  }
  attach(world) {
    this.detach(), this.internalWorld = world == null, this.world = world || new CANNON.World(), this.springBoneSystem.world = this.world, this.world.subsystems.push(this.springBoneSystem), this.bodies.forEach((b) => this.world.addBody(b)), this.constraints.forEach((c) => this.world.addConstraint(c)), this.reset(), this.enable = !0, this.world.bodies.forEach((b) => {
      b.collisionFilterGroup == 1 && b.collisionFilterMask == 1 && (b.collisionFilterMask = -1);
    });
  }
  detach() {
    !this.world || (this.world.subsystems = this.world.subsystems.filter((s) => s != this.springBoneSystem), this.world.constraints = this.world.constraints.filter((c) => !this.constraints.includes(c)), this.world.bodies = this.world.bodies.filter((b) => !this.bodies.includes(b)), this.world = null, this.enable = !1);
  }
  reset() {
    this.fixedBinds.forEach(([node, body]) => {
      node.updateWorldMatrix(!0, !1), body.position.copy(node.getWorldPosition(this._tmpV0)), body.quaternion.copy(node.parent.getWorldQuaternion(this._tmpQ0));
    }), this.binds.forEach(([node, body]) => {
      node.updateWorldMatrix(!0, !1), body.position.copy(node.getWorldPosition(this._tmpV0)), body.quaternion.copy(node.getWorldQuaternion(this._tmpQ0));
    });
  }
  update(timeDelta) {
    !this.enable || (this.fixedBinds.forEach(([node, body]) => {
      body.position.copy(node.getWorldPosition(this._tmpV0)), body.quaternion.copy(node.getWorldQuaternion(this._tmpQ0));
    }), this.internalWorld && this.world.step(1 / 60, timeDelta), this.binds.forEach(([node, body]) => {
      node.quaternion.copy(body.quaternion).premultiply(node.parent.getWorldQuaternion(this._tmpQ0).invert());
    }));
  }
  dispose() {
    this.detach();
  }
};

// src/utils/simpleik.ts
var IKNode = class {
  constructor(position, constraint, userData) {
    this.quaternion = new THREE.Quaternion();
    this.worldMatrix = new THREE.Matrix4();
    this.worldPosition = new THREE.Vector3();
    this.position = position, this.constraint = constraint, this.userData = userData;
  }
}, IKSolver = class {
  constructor() {
    this.iterationLimit = 50;
    this.thresholdSq = 1e-4;
    this._iv = new THREE.Vector3(1, 1, 1);
    this._tmpV0 = new THREE.Vector3();
    this._tmpV1 = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._tmpQ0 = new THREE.Quaternion();
    this._tmpQ1 = new THREE.Quaternion();
  }
  _updateChain(bones, parentMat) {
    for (let bone of bones)
      bone.worldMatrix.compose(bone.position, bone.quaternion, this._iv).premultiply(parentMat), bone.worldPosition.setFromMatrixPosition(bone.worldMatrix), parentMat = bone.worldMatrix;
  }
  solve(bones, target, boneSpaceMat) {
    this._updateChain(bones, boneSpaceMat);
    let endPosition = bones[bones.length - 1].worldPosition, startDistance = endPosition.distanceToSquared(target), targetDir = this._tmpV2, endDir = this._tmpV1, rotation = this._tmpQ1;
    for (let i = 0; i < this.iterationLimit && !(endPosition.distanceToSquared(target) < this.thresholdSq); i++) {
      let currentTarget = this._tmpV0.copy(target);
      for (let j = bones.length - 2; j >= 0; j--) {
        let bone = bones[j], endPos = bones[j + 1].position;
        bone.worldMatrix.decompose(this._tmpV1, this._tmpQ0, this._tmpV2), targetDir.copy(currentTarget).sub(this._tmpV1).applyQuaternion(rotation.copy(this._tmpQ0).invert()).normalize(), endDir.copy(endPos).normalize(), rotation.setFromUnitVectors(endDir, targetDir), bone.quaternion.multiply(rotation);
        let v = endDir.copy(endPos).applyQuaternion(this._tmpQ0.multiply(rotation));
        bone.constraint && (rotation.copy(bone.quaternion).invert(), bone.constraint.apply(bone) && (rotation.premultiply(bone.quaternion), v.copy(endPos).applyQuaternion(this._tmpQ0.multiply(rotation)))), currentTarget.sub(v);
      }
      this._updateChain(bones, boneSpaceMat);
    }
    return endPosition.distanceToSquared(target) < startDistance;
  }
};

// node_modules/three/build/three.module.js
var REVISION = "129";
var CullFaceNone = 0, CullFaceBack = 1, CullFaceFront = 2;
var PCFShadowMap = 1, PCFSoftShadowMap = 2, VSMShadowMap = 3, FrontSide = 0, BackSide = 1, DoubleSide = 2, FlatShading = 1;
var NoBlending = 0, NormalBlending = 1, AdditiveBlending = 2, SubtractiveBlending = 3, MultiplyBlending = 4, CustomBlending = 5, AddEquation = 100, SubtractEquation = 101, ReverseSubtractEquation = 102, MinEquation = 103, MaxEquation = 104, ZeroFactor = 200, OneFactor = 201, SrcColorFactor = 202, OneMinusSrcColorFactor = 203, SrcAlphaFactor = 204, OneMinusSrcAlphaFactor = 205, DstAlphaFactor = 206, OneMinusDstAlphaFactor = 207, DstColorFactor = 208, OneMinusDstColorFactor = 209, SrcAlphaSaturateFactor = 210, NeverDepth = 0, AlwaysDepth = 1, LessDepth = 2, LessEqualDepth = 3, EqualDepth = 4, GreaterEqualDepth = 5, GreaterDepth = 6, NotEqualDepth = 7, MultiplyOperation = 0, MixOperation = 1, AddOperation = 2, NoToneMapping = 0, LinearToneMapping = 1, ReinhardToneMapping = 2, CineonToneMapping = 3, ACESFilmicToneMapping = 4, CustomToneMapping = 5, UVMapping = 300, CubeReflectionMapping = 301, CubeRefractionMapping = 302, EquirectangularReflectionMapping = 303, EquirectangularRefractionMapping = 304, CubeUVReflectionMapping = 306, CubeUVRefractionMapping = 307, RepeatWrapping = 1e3, ClampToEdgeWrapping = 1001, MirroredRepeatWrapping = 1002, NearestFilter = 1003, NearestMipmapNearestFilter = 1004;
var NearestMipmapLinearFilter = 1005;
var LinearFilter = 1006, LinearMipmapNearestFilter = 1007;
var LinearMipmapLinearFilter = 1008;
var UnsignedByteType = 1009, ByteType = 1010, ShortType = 1011, UnsignedShortType = 1012, IntType = 1013, UnsignedIntType = 1014, FloatType = 1015, HalfFloatType = 1016, UnsignedShort4444Type = 1017, UnsignedShort5551Type = 1018, UnsignedShort565Type = 1019, UnsignedInt248Type = 1020, AlphaFormat = 1021, RGBFormat = 1022, RGBAFormat = 1023, LuminanceFormat = 1024, LuminanceAlphaFormat = 1025;
var DepthFormat = 1026, DepthStencilFormat = 1027, RedFormat = 1028, RedIntegerFormat = 1029, RGFormat = 1030, RGIntegerFormat = 1031, RGBIntegerFormat = 1032, RGBAIntegerFormat = 1033, RGB_S3TC_DXT1_Format = 33776, RGBA_S3TC_DXT1_Format = 33777, RGBA_S3TC_DXT3_Format = 33778, RGBA_S3TC_DXT5_Format = 33779, RGB_PVRTC_4BPPV1_Format = 35840, RGB_PVRTC_2BPPV1_Format = 35841, RGBA_PVRTC_4BPPV1_Format = 35842, RGBA_PVRTC_2BPPV1_Format = 35843, RGB_ETC1_Format = 36196, RGB_ETC2_Format = 37492, RGBA_ETC2_EAC_Format = 37496, RGBA_ASTC_4x4_Format = 37808, RGBA_ASTC_5x4_Format = 37809, RGBA_ASTC_5x5_Format = 37810, RGBA_ASTC_6x5_Format = 37811, RGBA_ASTC_6x6_Format = 37812, RGBA_ASTC_8x5_Format = 37813, RGBA_ASTC_8x6_Format = 37814, RGBA_ASTC_8x8_Format = 37815, RGBA_ASTC_10x5_Format = 37816, RGBA_ASTC_10x6_Format = 37817, RGBA_ASTC_10x8_Format = 37818, RGBA_ASTC_10x10_Format = 37819, RGBA_ASTC_12x10_Format = 37820, RGBA_ASTC_12x12_Format = 37821, RGBA_BPTC_Format = 36492, SRGB8_ALPHA8_ASTC_4x4_Format = 37840, SRGB8_ALPHA8_ASTC_5x4_Format = 37841, SRGB8_ALPHA8_ASTC_5x5_Format = 37842, SRGB8_ALPHA8_ASTC_6x5_Format = 37843, SRGB8_ALPHA8_ASTC_6x6_Format = 37844, SRGB8_ALPHA8_ASTC_8x5_Format = 37845, SRGB8_ALPHA8_ASTC_8x6_Format = 37846, SRGB8_ALPHA8_ASTC_8x8_Format = 37847, SRGB8_ALPHA8_ASTC_10x5_Format = 37848, SRGB8_ALPHA8_ASTC_10x6_Format = 37849, SRGB8_ALPHA8_ASTC_10x8_Format = 37850, SRGB8_ALPHA8_ASTC_10x10_Format = 37851, SRGB8_ALPHA8_ASTC_12x10_Format = 37852, SRGB8_ALPHA8_ASTC_12x12_Format = 37853, LoopOnce = 2200, LoopRepeat = 2201, LoopPingPong = 2202, InterpolateDiscrete = 2300, InterpolateLinear = 2301, InterpolateSmooth = 2302, ZeroCurvatureEnding = 2400, ZeroSlopeEnding = 2401, WrapAroundEnding = 2402, NormalAnimationBlendMode = 2500, AdditiveAnimationBlendMode = 2501, TrianglesDrawMode = 0;
var LinearEncoding = 3e3, sRGBEncoding = 3001, GammaEncoding = 3007, RGBEEncoding = 3002, LogLuvEncoding = 3003, RGBM7Encoding = 3004, RGBM16Encoding = 3005, RGBDEncoding = 3006, BasicDepthPacking = 3200, RGBADepthPacking = 3201, TangentSpaceNormalMap = 0, ObjectSpaceNormalMap = 1;
var KeepStencilOp = 7680;
var AlwaysStencilFunc = 519, StaticDrawUsage = 35044, DynamicDrawUsage = 35048;
var GLSL3 = "300 es", EventDispatcher = class {
  addEventListener(type, listener) {
    this._listeners === void 0 && (this._listeners = {});
    let listeners = this._listeners;
    listeners[type] === void 0 && (listeners[type] = []), listeners[type].indexOf(listener) === -1 && listeners[type].push(listener);
  }
  hasEventListener(type, listener) {
    if (this._listeners === void 0)
      return !1;
    let listeners = this._listeners;
    return listeners[type] !== void 0 && listeners[type].indexOf(listener) !== -1;
  }
  removeEventListener(type, listener) {
    if (this._listeners === void 0)
      return;
    let listenerArray = this._listeners[type];
    if (listenerArray !== void 0) {
      let index = listenerArray.indexOf(listener);
      index !== -1 && listenerArray.splice(index, 1);
    }
  }
  dispatchEvent(event) {
    if (this._listeners === void 0)
      return;
    let listenerArray = this._listeners[event.type];
    if (listenerArray !== void 0) {
      event.target = this;
      let array = listenerArray.slice(0);
      for (let i = 0, l = array.length; i < l; i++)
        array[i].call(this, event);
      event.target = null;
    }
  }
}, _lut = [];
for (let i = 0; i < 256; i++)
  _lut[i] = (i < 16 ? "0" : "") + i.toString(16);
var _seed = 1234567, DEG2RAD = Math.PI / 180, RAD2DEG = 180 / Math.PI;
function generateUUID() {
  let d0 = Math.random() * 4294967295 | 0, d1 = Math.random() * 4294967295 | 0, d2 = Math.random() * 4294967295 | 0, d3 = Math.random() * 4294967295 | 0;
  return (_lut[d0 & 255] + _lut[d0 >> 8 & 255] + _lut[d0 >> 16 & 255] + _lut[d0 >> 24 & 255] + "-" + _lut[d1 & 255] + _lut[d1 >> 8 & 255] + "-" + _lut[d1 >> 16 & 15 | 64] + _lut[d1 >> 24 & 255] + "-" + _lut[d2 & 63 | 128] + _lut[d2 >> 8 & 255] + "-" + _lut[d2 >> 16 & 255] + _lut[d2 >> 24 & 255] + _lut[d3 & 255] + _lut[d3 >> 8 & 255] + _lut[d3 >> 16 & 255] + _lut[d3 >> 24 & 255]).toUpperCase();
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function euclideanModulo(n, m) {
  return (n % m + m) % m;
}
function mapLinear(x, a1, a2, b1, b2) {
  return b1 + (x - a1) * (b2 - b1) / (a2 - a1);
}
function inverseLerp(x, y, value) {
  return x !== y ? (value - x) / (y - x) : 0;
}
function lerp(x, y, t) {
  return (1 - t) * x + t * y;
}
function damp(x, y, lambda, dt) {
  return lerp(x, y, 1 - Math.exp(-lambda * dt));
}
function pingpong(x, length = 1) {
  return length - Math.abs(euclideanModulo(x, length * 2) - length);
}
function smoothstep(x, min, max) {
  return x <= min ? 0 : x >= max ? 1 : (x = (x - min) / (max - min), x * x * (3 - 2 * x));
}
function smootherstep(x, min, max) {
  return x <= min ? 0 : x >= max ? 1 : (x = (x - min) / (max - min), x * x * x * (x * (x * 6 - 15) + 10));
}
function randInt(low, high) {
  return low + Math.floor(Math.random() * (high - low + 1));
}
function randFloat(low, high) {
  return low + Math.random() * (high - low);
}
function randFloatSpread(range) {
  return range * (0.5 - Math.random());
}
function seededRandom(s) {
  return s !== void 0 && (_seed = s % 2147483647), _seed = _seed * 16807 % 2147483647, (_seed - 1) / 2147483646;
}
function degToRad(degrees) {
  return degrees * DEG2RAD;
}
function radToDeg(radians) {
  return radians * RAD2DEG;
}
function isPowerOfTwo(value) {
  return (value & value - 1) == 0 && value !== 0;
}
function ceilPowerOfTwo(value) {
  return Math.pow(2, Math.ceil(Math.log(value) / Math.LN2));
}
function floorPowerOfTwo(value) {
  return Math.pow(2, Math.floor(Math.log(value) / Math.LN2));
}
function setQuaternionFromProperEuler(q, a, b, c, order) {
  let cos = Math.cos, sin = Math.sin, c2 = cos(b / 2), s2 = sin(b / 2), c13 = cos((a + c) / 2), s13 = sin((a + c) / 2), c1_3 = cos((a - c) / 2), s1_3 = sin((a - c) / 2), c3_1 = cos((c - a) / 2), s3_1 = sin((c - a) / 2);
  switch (order) {
    case "XYX":
      q.set(c2 * s13, s2 * c1_3, s2 * s1_3, c2 * c13);
      break;
    case "YZY":
      q.set(s2 * s1_3, c2 * s13, s2 * c1_3, c2 * c13);
      break;
    case "ZXZ":
      q.set(s2 * c1_3, s2 * s1_3, c2 * s13, c2 * c13);
      break;
    case "XZX":
      q.set(c2 * s13, s2 * s3_1, s2 * c3_1, c2 * c13);
      break;
    case "YXY":
      q.set(s2 * c3_1, c2 * s13, s2 * s3_1, c2 * c13);
      break;
    case "ZYZ":
      q.set(s2 * s3_1, s2 * c3_1, c2 * s13, c2 * c13);
      break;
    default:
      console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: " + order);
  }
}
var MathUtils = /* @__PURE__ */ Object.freeze({
  __proto__: null,
  DEG2RAD,
  RAD2DEG,
  generateUUID,
  clamp,
  euclideanModulo,
  mapLinear,
  inverseLerp,
  lerp,
  damp,
  pingpong,
  smoothstep,
  smootherstep,
  randInt,
  randFloat,
  randFloatSpread,
  seededRandom,
  degToRad,
  radToDeg,
  isPowerOfTwo,
  ceilPowerOfTwo,
  floorPowerOfTwo,
  setQuaternionFromProperEuler
}), Vector2 = class {
  constructor(x = 0, y = 0) {
    this.x = x, this.y = y;
  }
  get width() {
    return this.x;
  }
  set width(value) {
    this.x = value;
  }
  get height() {
    return this.y;
  }
  set height(value) {
    this.y = value;
  }
  set(x, y) {
    return this.x = x, this.y = y, this;
  }
  setScalar(scalar) {
    return this.x = scalar, this.y = scalar, this;
  }
  setX(x) {
    return this.x = x, this;
  }
  setY(y) {
    return this.y = y, this;
  }
  setComponent(index, value) {
    switch (index) {
      case 0:
        this.x = value;
        break;
      case 1:
        this.y = value;
        break;
      default:
        throw new Error("index is out of range: " + index);
    }
    return this;
  }
  getComponent(index) {
    switch (index) {
      case 0:
        return this.x;
      case 1:
        return this.y;
      default:
        throw new Error("index is out of range: " + index);
    }
  }
  clone() {
    return new this.constructor(this.x, this.y);
  }
  copy(v) {
    return this.x = v.x, this.y = v.y, this;
  }
  add(v, w) {
    return w !== void 0 ? (console.warn("THREE.Vector2: .add() now only accepts one argument. Use .addVectors( a, b ) instead."), this.addVectors(v, w)) : (this.x += v.x, this.y += v.y, this);
  }
  addScalar(s) {
    return this.x += s, this.y += s, this;
  }
  addVectors(a, b) {
    return this.x = a.x + b.x, this.y = a.y + b.y, this;
  }
  addScaledVector(v, s) {
    return this.x += v.x * s, this.y += v.y * s, this;
  }
  sub(v, w) {
    return w !== void 0 ? (console.warn("THREE.Vector2: .sub() now only accepts one argument. Use .subVectors( a, b ) instead."), this.subVectors(v, w)) : (this.x -= v.x, this.y -= v.y, this);
  }
  subScalar(s) {
    return this.x -= s, this.y -= s, this;
  }
  subVectors(a, b) {
    return this.x = a.x - b.x, this.y = a.y - b.y, this;
  }
  multiply(v) {
    return this.x *= v.x, this.y *= v.y, this;
  }
  multiplyScalar(scalar) {
    return this.x *= scalar, this.y *= scalar, this;
  }
  divide(v) {
    return this.x /= v.x, this.y /= v.y, this;
  }
  divideScalar(scalar) {
    return this.multiplyScalar(1 / scalar);
  }
  applyMatrix3(m) {
    let x = this.x, y = this.y, e = m.elements;
    return this.x = e[0] * x + e[3] * y + e[6], this.y = e[1] * x + e[4] * y + e[7], this;
  }
  min(v) {
    return this.x = Math.min(this.x, v.x), this.y = Math.min(this.y, v.y), this;
  }
  max(v) {
    return this.x = Math.max(this.x, v.x), this.y = Math.max(this.y, v.y), this;
  }
  clamp(min, max) {
    return this.x = Math.max(min.x, Math.min(max.x, this.x)), this.y = Math.max(min.y, Math.min(max.y, this.y)), this;
  }
  clampScalar(minVal, maxVal) {
    return this.x = Math.max(minVal, Math.min(maxVal, this.x)), this.y = Math.max(minVal, Math.min(maxVal, this.y)), this;
  }
  clampLength(min, max) {
    let length = this.length();
    return this.divideScalar(length || 1).multiplyScalar(Math.max(min, Math.min(max, length)));
  }
  floor() {
    return this.x = Math.floor(this.x), this.y = Math.floor(this.y), this;
  }
  ceil() {
    return this.x = Math.ceil(this.x), this.y = Math.ceil(this.y), this;
  }
  round() {
    return this.x = Math.round(this.x), this.y = Math.round(this.y), this;
  }
  roundToZero() {
    return this.x = this.x < 0 ? Math.ceil(this.x) : Math.floor(this.x), this.y = this.y < 0 ? Math.ceil(this.y) : Math.floor(this.y), this;
  }
  negate() {
    return this.x = -this.x, this.y = -this.y, this;
  }
  dot(v) {
    return this.x * v.x + this.y * v.y;
  }
  cross(v) {
    return this.x * v.y - this.y * v.x;
  }
  lengthSq() {
    return this.x * this.x + this.y * this.y;
  }
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  manhattanLength() {
    return Math.abs(this.x) + Math.abs(this.y);
  }
  normalize() {
    return this.divideScalar(this.length() || 1);
  }
  angle() {
    return Math.atan2(-this.y, -this.x) + Math.PI;
  }
  distanceTo(v) {
    return Math.sqrt(this.distanceToSquared(v));
  }
  distanceToSquared(v) {
    let dx = this.x - v.x, dy = this.y - v.y;
    return dx * dx + dy * dy;
  }
  manhattanDistanceTo(v) {
    return Math.abs(this.x - v.x) + Math.abs(this.y - v.y);
  }
  setLength(length) {
    return this.normalize().multiplyScalar(length);
  }
  lerp(v, alpha) {
    return this.x += (v.x - this.x) * alpha, this.y += (v.y - this.y) * alpha, this;
  }
  lerpVectors(v1, v2, alpha) {
    return this.x = v1.x + (v2.x - v1.x) * alpha, this.y = v1.y + (v2.y - v1.y) * alpha, this;
  }
  equals(v) {
    return v.x === this.x && v.y === this.y;
  }
  fromArray(array, offset = 0) {
    return this.x = array[offset], this.y = array[offset + 1], this;
  }
  toArray(array = [], offset = 0) {
    return array[offset] = this.x, array[offset + 1] = this.y, array;
  }
  fromBufferAttribute(attribute, index, offset) {
    return offset !== void 0 && console.warn("THREE.Vector2: offset has been removed from .fromBufferAttribute()."), this.x = attribute.getX(index), this.y = attribute.getY(index), this;
  }
  rotateAround(center, angle) {
    let c = Math.cos(angle), s = Math.sin(angle), x = this.x - center.x, y = this.y - center.y;
    return this.x = x * c - y * s + center.x, this.y = x * s + y * c + center.y, this;
  }
  random() {
    return this.x = Math.random(), this.y = Math.random(), this;
  }
};
Vector2.prototype.isVector2 = !0;
var Matrix3 = class {
  constructor() {
    this.elements = [
      1,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1
    ], arguments.length > 0 && console.error("THREE.Matrix3: the constructor no longer reads arguments. use .set() instead.");
  }
  set(n11, n12, n13, n21, n22, n23, n31, n32, n33) {
    let te = this.elements;
    return te[0] = n11, te[1] = n21, te[2] = n31, te[3] = n12, te[4] = n22, te[5] = n32, te[6] = n13, te[7] = n23, te[8] = n33, this;
  }
  identity() {
    return this.set(1, 0, 0, 0, 1, 0, 0, 0, 1), this;
  }
  copy(m) {
    let te = this.elements, me = m.elements;
    return te[0] = me[0], te[1] = me[1], te[2] = me[2], te[3] = me[3], te[4] = me[4], te[5] = me[5], te[6] = me[6], te[7] = me[7], te[8] = me[8], this;
  }
  extractBasis(xAxis, yAxis, zAxis) {
    return xAxis.setFromMatrix3Column(this, 0), yAxis.setFromMatrix3Column(this, 1), zAxis.setFromMatrix3Column(this, 2), this;
  }
  setFromMatrix4(m) {
    let me = m.elements;
    return this.set(me[0], me[4], me[8], me[1], me[5], me[9], me[2], me[6], me[10]), this;
  }
  multiply(m) {
    return this.multiplyMatrices(this, m);
  }
  premultiply(m) {
    return this.multiplyMatrices(m, this);
  }
  multiplyMatrices(a, b) {
    let ae = a.elements, be = b.elements, te = this.elements, a11 = ae[0], a12 = ae[3], a13 = ae[6], a21 = ae[1], a22 = ae[4], a23 = ae[7], a31 = ae[2], a32 = ae[5], a33 = ae[8], b11 = be[0], b12 = be[3], b13 = be[6], b21 = be[1], b22 = be[4], b23 = be[7], b31 = be[2], b32 = be[5], b33 = be[8];
    return te[0] = a11 * b11 + a12 * b21 + a13 * b31, te[3] = a11 * b12 + a12 * b22 + a13 * b32, te[6] = a11 * b13 + a12 * b23 + a13 * b33, te[1] = a21 * b11 + a22 * b21 + a23 * b31, te[4] = a21 * b12 + a22 * b22 + a23 * b32, te[7] = a21 * b13 + a22 * b23 + a23 * b33, te[2] = a31 * b11 + a32 * b21 + a33 * b31, te[5] = a31 * b12 + a32 * b22 + a33 * b32, te[8] = a31 * b13 + a32 * b23 + a33 * b33, this;
  }
  multiplyScalar(s) {
    let te = this.elements;
    return te[0] *= s, te[3] *= s, te[6] *= s, te[1] *= s, te[4] *= s, te[7] *= s, te[2] *= s, te[5] *= s, te[8] *= s, this;
  }
  determinant() {
    let te = this.elements, a = te[0], b = te[1], c = te[2], d = te[3], e = te[4], f = te[5], g = te[6], h = te[7], i = te[8];
    return a * e * i - a * f * h - b * d * i + b * f * g + c * d * h - c * e * g;
  }
  invert() {
    let te = this.elements, n11 = te[0], n21 = te[1], n31 = te[2], n12 = te[3], n22 = te[4], n32 = te[5], n13 = te[6], n23 = te[7], n33 = te[8], t11 = n33 * n22 - n32 * n23, t12 = n32 * n13 - n33 * n12, t13 = n23 * n12 - n22 * n13, det = n11 * t11 + n21 * t12 + n31 * t13;
    if (det === 0)
      return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0);
    let detInv = 1 / det;
    return te[0] = t11 * detInv, te[1] = (n31 * n23 - n33 * n21) * detInv, te[2] = (n32 * n21 - n31 * n22) * detInv, te[3] = t12 * detInv, te[4] = (n33 * n11 - n31 * n13) * detInv, te[5] = (n31 * n12 - n32 * n11) * detInv, te[6] = t13 * detInv, te[7] = (n21 * n13 - n23 * n11) * detInv, te[8] = (n22 * n11 - n21 * n12) * detInv, this;
  }
  transpose() {
    let tmp2, m = this.elements;
    return tmp2 = m[1], m[1] = m[3], m[3] = tmp2, tmp2 = m[2], m[2] = m[6], m[6] = tmp2, tmp2 = m[5], m[5] = m[7], m[7] = tmp2, this;
  }
  getNormalMatrix(matrix4) {
    return this.setFromMatrix4(matrix4).invert().transpose();
  }
  transposeIntoArray(r) {
    let m = this.elements;
    return r[0] = m[0], r[1] = m[3], r[2] = m[6], r[3] = m[1], r[4] = m[4], r[5] = m[7], r[6] = m[2], r[7] = m[5], r[8] = m[8], this;
  }
  setUvTransform(tx, ty, sx, sy, rotation, cx, cy) {
    let c = Math.cos(rotation), s = Math.sin(rotation);
    return this.set(sx * c, sx * s, -sx * (c * cx + s * cy) + cx + tx, -sy * s, sy * c, -sy * (-s * cx + c * cy) + cy + ty, 0, 0, 1), this;
  }
  scale(sx, sy) {
    let te = this.elements;
    return te[0] *= sx, te[3] *= sx, te[6] *= sx, te[1] *= sy, te[4] *= sy, te[7] *= sy, this;
  }
  rotate(theta) {
    let c = Math.cos(theta), s = Math.sin(theta), te = this.elements, a11 = te[0], a12 = te[3], a13 = te[6], a21 = te[1], a22 = te[4], a23 = te[7];
    return te[0] = c * a11 + s * a21, te[3] = c * a12 + s * a22, te[6] = c * a13 + s * a23, te[1] = -s * a11 + c * a21, te[4] = -s * a12 + c * a22, te[7] = -s * a13 + c * a23, this;
  }
  translate(tx, ty) {
    let te = this.elements;
    return te[0] += tx * te[2], te[3] += tx * te[5], te[6] += tx * te[8], te[1] += ty * te[2], te[4] += ty * te[5], te[7] += ty * te[8], this;
  }
  equals(matrix) {
    let te = this.elements, me = matrix.elements;
    for (let i = 0; i < 9; i++)
      if (te[i] !== me[i])
        return !1;
    return !0;
  }
  fromArray(array, offset = 0) {
    for (let i = 0; i < 9; i++)
      this.elements[i] = array[i + offset];
    return this;
  }
  toArray(array = [], offset = 0) {
    let te = this.elements;
    return array[offset] = te[0], array[offset + 1] = te[1], array[offset + 2] = te[2], array[offset + 3] = te[3], array[offset + 4] = te[4], array[offset + 5] = te[5], array[offset + 6] = te[6], array[offset + 7] = te[7], array[offset + 8] = te[8], array;
  }
  clone() {
    return new this.constructor().fromArray(this.elements);
  }
};
Matrix3.prototype.isMatrix3 = !0;
var _canvas, ImageUtils = class {
  static getDataURL(image) {
    if (/^data:/i.test(image.src) || typeof HTMLCanvasElement == "undefined")
      return image.src;
    let canvas;
    if (image instanceof HTMLCanvasElement)
      canvas = image;
    else {
      _canvas === void 0 && (_canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas")), _canvas.width = image.width, _canvas.height = image.height;
      let context = _canvas.getContext("2d");
      image instanceof ImageData ? context.putImageData(image, 0, 0) : context.drawImage(image, 0, 0, image.width, image.height), canvas = _canvas;
    }
    return canvas.width > 2048 || canvas.height > 2048 ? (console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons", image), canvas.toDataURL("image/jpeg", 0.6)) : canvas.toDataURL("image/png");
  }
}, textureId = 0, Texture = class extends EventDispatcher {
  constructor(image = Texture.DEFAULT_IMAGE, mapping = Texture.DEFAULT_MAPPING, wrapS = ClampToEdgeWrapping, wrapT = ClampToEdgeWrapping, magFilter = LinearFilter, minFilter = LinearMipmapLinearFilter, format = RGBAFormat, type = UnsignedByteType, anisotropy = 1, encoding = LinearEncoding) {
    super();
    Object.defineProperty(this, "id", { value: textureId++ }), this.uuid = generateUUID(), this.name = "", this.image = image, this.mipmaps = [], this.mapping = mapping, this.wrapS = wrapS, this.wrapT = wrapT, this.magFilter = magFilter, this.minFilter = minFilter, this.anisotropy = anisotropy, this.format = format, this.internalFormat = null, this.type = type, this.offset = new Vector2(0, 0), this.repeat = new Vector2(1, 1), this.center = new Vector2(0, 0), this.rotation = 0, this.matrixAutoUpdate = !0, this.matrix = new Matrix3(), this.generateMipmaps = !0, this.premultiplyAlpha = !1, this.flipY = !0, this.unpackAlignment = 4, this.encoding = encoding, this.version = 0, this.onUpdate = null;
  }
  updateMatrix() {
    this.matrix.setUvTransform(this.offset.x, this.offset.y, this.repeat.x, this.repeat.y, this.rotation, this.center.x, this.center.y);
  }
  clone() {
    return new this.constructor().copy(this);
  }
  copy(source) {
    return this.name = source.name, this.image = source.image, this.mipmaps = source.mipmaps.slice(0), this.mapping = source.mapping, this.wrapS = source.wrapS, this.wrapT = source.wrapT, this.magFilter = source.magFilter, this.minFilter = source.minFilter, this.anisotropy = source.anisotropy, this.format = source.format, this.internalFormat = source.internalFormat, this.type = source.type, this.offset.copy(source.offset), this.repeat.copy(source.repeat), this.center.copy(source.center), this.rotation = source.rotation, this.matrixAutoUpdate = source.matrixAutoUpdate, this.matrix.copy(source.matrix), this.generateMipmaps = source.generateMipmaps, this.premultiplyAlpha = source.premultiplyAlpha, this.flipY = source.flipY, this.unpackAlignment = source.unpackAlignment, this.encoding = source.encoding, this;
  }
  toJSON(meta) {
    let isRootObject = meta === void 0 || typeof meta == "string";
    if (!isRootObject && meta.textures[this.uuid] !== void 0)
      return meta.textures[this.uuid];
    let output = {
      metadata: {
        version: 4.5,
        type: "Texture",
        generator: "Texture.toJSON"
      },
      uuid: this.uuid,
      name: this.name,
      mapping: this.mapping,
      repeat: [this.repeat.x, this.repeat.y],
      offset: [this.offset.x, this.offset.y],
      center: [this.center.x, this.center.y],
      rotation: this.rotation,
      wrap: [this.wrapS, this.wrapT],
      format: this.format,
      type: this.type,
      encoding: this.encoding,
      minFilter: this.minFilter,
      magFilter: this.magFilter,
      anisotropy: this.anisotropy,
      flipY: this.flipY,
      premultiplyAlpha: this.premultiplyAlpha,
      unpackAlignment: this.unpackAlignment
    };
    if (this.image !== void 0) {
      let image = this.image;
      if (image.uuid === void 0 && (image.uuid = generateUUID()), !isRootObject && meta.images[image.uuid] === void 0) {
        let url;
        if (Array.isArray(image)) {
          url = [];
          for (let i = 0, l = image.length; i < l; i++)
            image[i].isDataTexture ? url.push(serializeImage(image[i].image)) : url.push(serializeImage(image[i]));
        } else
          url = serializeImage(image);
        meta.images[image.uuid] = {
          uuid: image.uuid,
          url
        };
      }
      output.image = image.uuid;
    }
    return isRootObject || (meta.textures[this.uuid] = output), output;
  }
  dispose() {
    this.dispatchEvent({ type: "dispose" });
  }
  transformUv(uv) {
    if (this.mapping !== UVMapping)
      return uv;
    if (uv.applyMatrix3(this.matrix), uv.x < 0 || uv.x > 1)
      switch (this.wrapS) {
        case RepeatWrapping:
          uv.x = uv.x - Math.floor(uv.x);
          break;
        case ClampToEdgeWrapping:
          uv.x = uv.x < 0 ? 0 : 1;
          break;
        case MirroredRepeatWrapping:
          Math.abs(Math.floor(uv.x) % 2) === 1 ? uv.x = Math.ceil(uv.x) - uv.x : uv.x = uv.x - Math.floor(uv.x);
          break;
      }
    if (uv.y < 0 || uv.y > 1)
      switch (this.wrapT) {
        case RepeatWrapping:
          uv.y = uv.y - Math.floor(uv.y);
          break;
        case ClampToEdgeWrapping:
          uv.y = uv.y < 0 ? 0 : 1;
          break;
        case MirroredRepeatWrapping:
          Math.abs(Math.floor(uv.y) % 2) === 1 ? uv.y = Math.ceil(uv.y) - uv.y : uv.y = uv.y - Math.floor(uv.y);
          break;
      }
    return this.flipY && (uv.y = 1 - uv.y), uv;
  }
  set needsUpdate(value) {
    value === !0 && this.version++;
  }
};
Texture.DEFAULT_IMAGE = void 0;
Texture.DEFAULT_MAPPING = UVMapping;
Texture.prototype.isTexture = !0;
function serializeImage(image) {
  return typeof HTMLImageElement != "undefined" && image instanceof HTMLImageElement || typeof HTMLCanvasElement != "undefined" && image instanceof HTMLCanvasElement || typeof ImageBitmap != "undefined" && image instanceof ImageBitmap ? ImageUtils.getDataURL(image) : image.data ? {
    data: Array.prototype.slice.call(image.data),
    width: image.width,
    height: image.height,
    type: image.data.constructor.name
  } : (console.warn("THREE.Texture: Unable to serialize Texture."), {});
}
var Vector4 = class {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x, this.y = y, this.z = z, this.w = w;
  }
  get width() {
    return this.z;
  }
  set width(value) {
    this.z = value;
  }
  get height() {
    return this.w;
  }
  set height(value) {
    this.w = value;
  }
  set(x, y, z, w) {
    return this.x = x, this.y = y, this.z = z, this.w = w, this;
  }
  setScalar(scalar) {
    return this.x = scalar, this.y = scalar, this.z = scalar, this.w = scalar, this;
  }
  setX(x) {
    return this.x = x, this;
  }
  setY(y) {
    return this.y = y, this;
  }
  setZ(z) {
    return this.z = z, this;
  }
  setW(w) {
    return this.w = w, this;
  }
  setComponent(index, value) {
    switch (index) {
      case 0:
        this.x = value;
        break;
      case 1:
        this.y = value;
        break;
      case 2:
        this.z = value;
        break;
      case 3:
        this.w = value;
        break;
      default:
        throw new Error("index is out of range: " + index);
    }
    return this;
  }
  getComponent(index) {
    switch (index) {
      case 0:
        return this.x;
      case 1:
        return this.y;
      case 2:
        return this.z;
      case 3:
        return this.w;
      default:
        throw new Error("index is out of range: " + index);
    }
  }
  clone() {
    return new this.constructor(this.x, this.y, this.z, this.w);
  }
  copy(v) {
    return this.x = v.x, this.y = v.y, this.z = v.z, this.w = v.w !== void 0 ? v.w : 1, this;
  }
  add(v, w) {
    return w !== void 0 ? (console.warn("THREE.Vector4: .add() now only accepts one argument. Use .addVectors( a, b ) instead."), this.addVectors(v, w)) : (this.x += v.x, this.y += v.y, this.z += v.z, this.w += v.w, this);
  }
  addScalar(s) {
    return this.x += s, this.y += s, this.z += s, this.w += s, this;
  }
  addVectors(a, b) {
    return this.x = a.x + b.x, this.y = a.y + b.y, this.z = a.z + b.z, this.w = a.w + b.w, this;
  }
  addScaledVector(v, s) {
    return this.x += v.x * s, this.y += v.y * s, this.z += v.z * s, this.w += v.w * s, this;
  }
  sub(v, w) {
    return w !== void 0 ? (console.warn("THREE.Vector4: .sub() now only accepts one argument. Use .subVectors( a, b ) instead."), this.subVectors(v, w)) : (this.x -= v.x, this.y -= v.y, this.z -= v.z, this.w -= v.w, this);
  }
  subScalar(s) {
    return this.x -= s, this.y -= s, this.z -= s, this.w -= s, this;
  }
  subVectors(a, b) {
    return this.x = a.x - b.x, this.y = a.y - b.y, this.z = a.z - b.z, this.w = a.w - b.w, this;
  }
  multiply(v) {
    return this.x *= v.x, this.y *= v.y, this.z *= v.z, this.w *= v.w, this;
  }
  multiplyScalar(scalar) {
    return this.x *= scalar, this.y *= scalar, this.z *= scalar, this.w *= scalar, this;
  }
  applyMatrix4(m) {
    let x = this.x, y = this.y, z = this.z, w = this.w, e = m.elements;
    return this.x = e[0] * x + e[4] * y + e[8] * z + e[12] * w, this.y = e[1] * x + e[5] * y + e[9] * z + e[13] * w, this.z = e[2] * x + e[6] * y + e[10] * z + e[14] * w, this.w = e[3] * x + e[7] * y + e[11] * z + e[15] * w, this;
  }
  divideScalar(scalar) {
    return this.multiplyScalar(1 / scalar);
  }
  setAxisAngleFromQuaternion(q) {
    this.w = 2 * Math.acos(q.w);
    let s = Math.sqrt(1 - q.w * q.w);
    return s < 1e-4 ? (this.x = 1, this.y = 0, this.z = 0) : (this.x = q.x / s, this.y = q.y / s, this.z = q.z / s), this;
  }
  setAxisAngleFromRotationMatrix(m) {
    let angle, x, y, z, epsilon = 0.01, epsilon2 = 0.1, te = m.elements, m11 = te[0], m12 = te[4], m13 = te[8], m21 = te[1], m22 = te[5], m23 = te[9], m31 = te[2], m32 = te[6], m33 = te[10];
    if (Math.abs(m12 - m21) < epsilon && Math.abs(m13 - m31) < epsilon && Math.abs(m23 - m32) < epsilon) {
      if (Math.abs(m12 + m21) < epsilon2 && Math.abs(m13 + m31) < epsilon2 && Math.abs(m23 + m32) < epsilon2 && Math.abs(m11 + m22 + m33 - 3) < epsilon2)
        return this.set(1, 0, 0, 0), this;
      angle = Math.PI;
      let xx = (m11 + 1) / 2, yy = (m22 + 1) / 2, zz = (m33 + 1) / 2, xy = (m12 + m21) / 4, xz = (m13 + m31) / 4, yz = (m23 + m32) / 4;
      return xx > yy && xx > zz ? xx < epsilon ? (x = 0, y = 0.707106781, z = 0.707106781) : (x = Math.sqrt(xx), y = xy / x, z = xz / x) : yy > zz ? yy < epsilon ? (x = 0.707106781, y = 0, z = 0.707106781) : (y = Math.sqrt(yy), x = xy / y, z = yz / y) : zz < epsilon ? (x = 0.707106781, y = 0.707106781, z = 0) : (z = Math.sqrt(zz), x = xz / z, y = yz / z), this.set(x, y, z, angle), this;
    }
    let s = Math.sqrt((m32 - m23) * (m32 - m23) + (m13 - m31) * (m13 - m31) + (m21 - m12) * (m21 - m12));
    return Math.abs(s) < 1e-3 && (s = 1), this.x = (m32 - m23) / s, this.y = (m13 - m31) / s, this.z = (m21 - m12) / s, this.w = Math.acos((m11 + m22 + m33 - 1) / 2), this;
  }
  min(v) {
    return this.x = Math.min(this.x, v.x), this.y = Math.min(this.y, v.y), this.z = Math.min(this.z, v.z), this.w = Math.min(this.w, v.w), this;
  }
  max(v) {
    return this.x = Math.max(this.x, v.x), this.y = Math.max(this.y, v.y), this.z = Math.max(this.z, v.z), this.w = Math.max(this.w, v.w), this;
  }
  clamp(min, max) {
    return this.x = Math.max(min.x, Math.min(max.x, this.x)), this.y = Math.max(min.y, Math.min(max.y, this.y)), this.z = Math.max(min.z, Math.min(max.z, this.z)), this.w = Math.max(min.w, Math.min(max.w, this.w)), this;
  }
  clampScalar(minVal, maxVal) {
    return this.x = Math.max(minVal, Math.min(maxVal, this.x)), this.y = Math.max(minVal, Math.min(maxVal, this.y)), this.z = Math.max(minVal, Math.min(maxVal, this.z)), this.w = Math.max(minVal, Math.min(maxVal, this.w)), this;
  }
  clampLength(min, max) {
    let length = this.length();
    return this.divideScalar(length || 1).multiplyScalar(Math.max(min, Math.min(max, length)));
  }
  floor() {
    return this.x = Math.floor(this.x), this.y = Math.floor(this.y), this.z = Math.floor(this.z), this.w = Math.floor(this.w), this;
  }
  ceil() {
    return this.x = Math.ceil(this.x), this.y = Math.ceil(this.y), this.z = Math.ceil(this.z), this.w = Math.ceil(this.w), this;
  }
  round() {
    return this.x = Math.round(this.x), this.y = Math.round(this.y), this.z = Math.round(this.z), this.w = Math.round(this.w), this;
  }
  roundToZero() {
    return this.x = this.x < 0 ? Math.ceil(this.x) : Math.floor(this.x), this.y = this.y < 0 ? Math.ceil(this.y) : Math.floor(this.y), this.z = this.z < 0 ? Math.ceil(this.z) : Math.floor(this.z), this.w = this.w < 0 ? Math.ceil(this.w) : Math.floor(this.w), this;
  }
  negate() {
    return this.x = -this.x, this.y = -this.y, this.z = -this.z, this.w = -this.w, this;
  }
  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
  }
  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
  }
  manhattanLength() {
    return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + Math.abs(this.w);
  }
  normalize() {
    return this.divideScalar(this.length() || 1);
  }
  setLength(length) {
    return this.normalize().multiplyScalar(length);
  }
  lerp(v, alpha) {
    return this.x += (v.x - this.x) * alpha, this.y += (v.y - this.y) * alpha, this.z += (v.z - this.z) * alpha, this.w += (v.w - this.w) * alpha, this;
  }
  lerpVectors(v1, v2, alpha) {
    return this.x = v1.x + (v2.x - v1.x) * alpha, this.y = v1.y + (v2.y - v1.y) * alpha, this.z = v1.z + (v2.z - v1.z) * alpha, this.w = v1.w + (v2.w - v1.w) * alpha, this;
  }
  equals(v) {
    return v.x === this.x && v.y === this.y && v.z === this.z && v.w === this.w;
  }
  fromArray(array, offset = 0) {
    return this.x = array[offset], this.y = array[offset + 1], this.z = array[offset + 2], this.w = array[offset + 3], this;
  }
  toArray(array = [], offset = 0) {
    return array[offset] = this.x, array[offset + 1] = this.y, array[offset + 2] = this.z, array[offset + 3] = this.w, array;
  }
  fromBufferAttribute(attribute, index, offset) {
    return offset !== void 0 && console.warn("THREE.Vector4: offset has been removed from .fromBufferAttribute()."), this.x = attribute.getX(index), this.y = attribute.getY(index), this.z = attribute.getZ(index), this.w = attribute.getW(index), this;
  }
  random() {
    return this.x = Math.random(), this.y = Math.random(), this.z = Math.random(), this.w = Math.random(), this;
  }
};
Vector4.prototype.isVector4 = !0;
var WebGLRenderTarget = class extends EventDispatcher {
  constructor(width, height, options) {
    super();
    this.width = width, this.height = height, this.depth = 1, this.scissor = new Vector4(0, 0, width, height), this.scissorTest = !1, this.viewport = new Vector4(0, 0, width, height), options = options || {}, this.texture = new Texture(void 0, options.mapping, options.wrapS, options.wrapT, options.magFilter, options.minFilter, options.format, options.type, options.anisotropy, options.encoding), this.texture.image = {}, this.texture.image.width = width, this.texture.image.height = height, this.texture.image.depth = 1, this.texture.generateMipmaps = options.generateMipmaps !== void 0 ? options.generateMipmaps : !1, this.texture.minFilter = options.minFilter !== void 0 ? options.minFilter : LinearFilter, this.depthBuffer = options.depthBuffer !== void 0 ? options.depthBuffer : !0, this.stencilBuffer = options.stencilBuffer !== void 0 ? options.stencilBuffer : !1, this.depthTexture = options.depthTexture !== void 0 ? options.depthTexture : null;
  }
  setTexture(texture) {
    texture.image = {
      width: this.width,
      height: this.height,
      depth: this.depth
    }, this.texture = texture;
  }
  setSize(width, height, depth = 1) {
    (this.width !== width || this.height !== height || this.depth !== depth) && (this.width = width, this.height = height, this.depth = depth, this.texture.image.width = width, this.texture.image.height = height, this.texture.image.depth = depth, this.dispose()), this.viewport.set(0, 0, width, height), this.scissor.set(0, 0, width, height);
  }
  clone() {
    return new this.constructor().copy(this);
  }
  copy(source) {
    return this.width = source.width, this.height = source.height, this.depth = source.depth, this.viewport.copy(source.viewport), this.texture = source.texture.clone(), this.texture.image = { ...this.texture.image }, this.depthBuffer = source.depthBuffer, this.stencilBuffer = source.stencilBuffer, this.depthTexture = source.depthTexture, this;
  }
  dispose() {
    this.dispatchEvent({ type: "dispose" });
  }
};
WebGLRenderTarget.prototype.isWebGLRenderTarget = !0;
var WebGLMultipleRenderTargets = class extends WebGLRenderTarget {
  constructor(width, height, count) {
    super(width, height);
    let texture = this.texture;
    this.texture = [];
    for (let i = 0; i < count; i++)
      this.texture[i] = texture.clone();
  }
  setSize(width, height, depth = 1) {
    if (this.width !== width || this.height !== height || this.depth !== depth) {
      this.width = width, this.height = height, this.depth = depth;
      for (let i = 0, il = this.texture.length; i < il; i++)
        this.texture[i].image.width = width, this.texture[i].image.height = height, this.texture[i].image.depth = depth;
      this.dispose();
    }
    return this.viewport.set(0, 0, width, height), this.scissor.set(0, 0, width, height), this;
  }
  copy(source) {
    this.dispose(), this.width = source.width, this.height = source.height, this.depth = source.depth, this.viewport.set(0, 0, this.width, this.height), this.scissor.set(0, 0, this.width, this.height), this.depthBuffer = source.depthBuffer, this.stencilBuffer = source.stencilBuffer, this.depthTexture = source.depthTexture, this.texture.length = 0;
    for (let i = 0, il = source.texture.length; i < il; i++)
      this.texture[i] = source.texture[i].clone();
    return this;
  }
};
WebGLMultipleRenderTargets.prototype.isWebGLMultipleRenderTargets = !0;
var WebGLMultisampleRenderTarget = class extends WebGLRenderTarget {
  constructor(width, height, options) {
    super(width, height, options);
    this.samples = 4;
  }
  copy(source) {
    return super.copy.call(this, source), this.samples = source.samples, this;
  }
};
WebGLMultisampleRenderTarget.prototype.isWebGLMultisampleRenderTarget = !0;
var Quaternion = class {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this._x = x, this._y = y, this._z = z, this._w = w;
  }
  static slerp(qa, qb, qm, t) {
    return console.warn("THREE.Quaternion: Static .slerp() has been deprecated. Use qm.slerpQuaternions( qa, qb, t ) instead."), qm.slerpQuaternions(qa, qb, t);
  }
  static slerpFlat(dst, dstOffset, src0, srcOffset0, src1, srcOffset1, t) {
    let x0 = src0[srcOffset0 + 0], y0 = src0[srcOffset0 + 1], z0 = src0[srcOffset0 + 2], w0 = src0[srcOffset0 + 3], x1 = src1[srcOffset1 + 0], y1 = src1[srcOffset1 + 1], z1 = src1[srcOffset1 + 2], w1 = src1[srcOffset1 + 3];
    if (t === 0) {
      dst[dstOffset + 0] = x0, dst[dstOffset + 1] = y0, dst[dstOffset + 2] = z0, dst[dstOffset + 3] = w0;
      return;
    }
    if (t === 1) {
      dst[dstOffset + 0] = x1, dst[dstOffset + 1] = y1, dst[dstOffset + 2] = z1, dst[dstOffset + 3] = w1;
      return;
    }
    if (w0 !== w1 || x0 !== x1 || y0 !== y1 || z0 !== z1) {
      let s = 1 - t, cos = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1, dir = cos >= 0 ? 1 : -1, sqrSin = 1 - cos * cos;
      if (sqrSin > Number.EPSILON) {
        let sin = Math.sqrt(sqrSin), len = Math.atan2(sin, cos * dir);
        s = Math.sin(s * len) / sin, t = Math.sin(t * len) / sin;
      }
      let tDir = t * dir;
      if (x0 = x0 * s + x1 * tDir, y0 = y0 * s + y1 * tDir, z0 = z0 * s + z1 * tDir, w0 = w0 * s + w1 * tDir, s === 1 - t) {
        let f = 1 / Math.sqrt(x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0);
        x0 *= f, y0 *= f, z0 *= f, w0 *= f;
      }
    }
    dst[dstOffset] = x0, dst[dstOffset + 1] = y0, dst[dstOffset + 2] = z0, dst[dstOffset + 3] = w0;
  }
  static multiplyQuaternionsFlat(dst, dstOffset, src0, srcOffset0, src1, srcOffset1) {
    let x0 = src0[srcOffset0], y0 = src0[srcOffset0 + 1], z0 = src0[srcOffset0 + 2], w0 = src0[srcOffset0 + 3], x1 = src1[srcOffset1], y1 = src1[srcOffset1 + 1], z1 = src1[srcOffset1 + 2], w1 = src1[srcOffset1 + 3];
    return dst[dstOffset] = x0 * w1 + w0 * x1 + y0 * z1 - z0 * y1, dst[dstOffset + 1] = y0 * w1 + w0 * y1 + z0 * x1 - x0 * z1, dst[dstOffset + 2] = z0 * w1 + w0 * z1 + x0 * y1 - y0 * x1, dst[dstOffset + 3] = w0 * w1 - x0 * x1 - y0 * y1 - z0 * z1, dst;
  }
  get x() {
    return this._x;
  }
  set x(value) {
    this._x = value, this._onChangeCallback();
  }
  get y() {
    return this._y;
  }
  set y(value) {
    this._y = value, this._onChangeCallback();
  }
  get z() {
    return this._z;
  }
  set z(value) {
    this._z = value, this._onChangeCallback();
  }
  get w() {
    return this._w;
  }
  set w(value) {
    this._w = value, this._onChangeCallback();
  }
  set(x, y, z, w) {
    return this._x = x, this._y = y, this._z = z, this._w = w, this._onChangeCallback(), this;
  }
  clone() {
    return new this.constructor(this._x, this._y, this._z, this._w);
  }
  copy(quaternion) {
    return this._x = quaternion.x, this._y = quaternion.y, this._z = quaternion.z, this._w = quaternion.w, this._onChangeCallback(), this;
  }
  setFromEuler(euler, update) {
    if (!(euler && euler.isEuler))
      throw new Error("THREE.Quaternion: .setFromEuler() now expects an Euler rotation rather than a Vector3 and order.");
    let x = euler._x, y = euler._y, z = euler._z, order = euler._order, cos = Math.cos, sin = Math.sin, c1 = cos(x / 2), c2 = cos(y / 2), c3 = cos(z / 2), s1 = sin(x / 2), s2 = sin(y / 2), s3 = sin(z / 2);
    switch (order) {
      case "XYZ":
        this._x = s1 * c2 * c3 + c1 * s2 * s3, this._y = c1 * s2 * c3 - s1 * c2 * s3, this._z = c1 * c2 * s3 + s1 * s2 * c3, this._w = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case "YXZ":
        this._x = s1 * c2 * c3 + c1 * s2 * s3, this._y = c1 * s2 * c3 - s1 * c2 * s3, this._z = c1 * c2 * s3 - s1 * s2 * c3, this._w = c1 * c2 * c3 + s1 * s2 * s3;
        break;
      case "ZXY":
        this._x = s1 * c2 * c3 - c1 * s2 * s3, this._y = c1 * s2 * c3 + s1 * c2 * s3, this._z = c1 * c2 * s3 + s1 * s2 * c3, this._w = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case "ZYX":
        this._x = s1 * c2 * c3 - c1 * s2 * s3, this._y = c1 * s2 * c3 + s1 * c2 * s3, this._z = c1 * c2 * s3 - s1 * s2 * c3, this._w = c1 * c2 * c3 + s1 * s2 * s3;
        break;
      case "YZX":
        this._x = s1 * c2 * c3 + c1 * s2 * s3, this._y = c1 * s2 * c3 + s1 * c2 * s3, this._z = c1 * c2 * s3 - s1 * s2 * c3, this._w = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case "XZY":
        this._x = s1 * c2 * c3 - c1 * s2 * s3, this._y = c1 * s2 * c3 - s1 * c2 * s3, this._z = c1 * c2 * s3 + s1 * s2 * c3, this._w = c1 * c2 * c3 + s1 * s2 * s3;
        break;
      default:
        console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: " + order);
    }
    return update !== !1 && this._onChangeCallback(), this;
  }
  setFromAxisAngle(axis, angle) {
    let halfAngle = angle / 2, s = Math.sin(halfAngle);
    return this._x = axis.x * s, this._y = axis.y * s, this._z = axis.z * s, this._w = Math.cos(halfAngle), this._onChangeCallback(), this;
  }
  setFromRotationMatrix(m) {
    let te = m.elements, m11 = te[0], m12 = te[4], m13 = te[8], m21 = te[1], m22 = te[5], m23 = te[9], m31 = te[2], m32 = te[6], m33 = te[10], trace = m11 + m22 + m33;
    if (trace > 0) {
      let s = 0.5 / Math.sqrt(trace + 1);
      this._w = 0.25 / s, this._x = (m32 - m23) * s, this._y = (m13 - m31) * s, this._z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      let s = 2 * Math.sqrt(1 + m11 - m22 - m33);
      this._w = (m32 - m23) / s, this._x = 0.25 * s, this._y = (m12 + m21) / s, this._z = (m13 + m31) / s;
    } else if (m22 > m33) {
      let s = 2 * Math.sqrt(1 + m22 - m11 - m33);
      this._w = (m13 - m31) / s, this._x = (m12 + m21) / s, this._y = 0.25 * s, this._z = (m23 + m32) / s;
    } else {
      let s = 2 * Math.sqrt(1 + m33 - m11 - m22);
      this._w = (m21 - m12) / s, this._x = (m13 + m31) / s, this._y = (m23 + m32) / s, this._z = 0.25 * s;
    }
    return this._onChangeCallback(), this;
  }
  setFromUnitVectors(vFrom, vTo) {
    let r = vFrom.dot(vTo) + 1;
    return r < Number.EPSILON ? (r = 0, Math.abs(vFrom.x) > Math.abs(vFrom.z) ? (this._x = -vFrom.y, this._y = vFrom.x, this._z = 0, this._w = r) : (this._x = 0, this._y = -vFrom.z, this._z = vFrom.y, this._w = r)) : (this._x = vFrom.y * vTo.z - vFrom.z * vTo.y, this._y = vFrom.z * vTo.x - vFrom.x * vTo.z, this._z = vFrom.x * vTo.y - vFrom.y * vTo.x, this._w = r), this.normalize();
  }
  angleTo(q) {
    return 2 * Math.acos(Math.abs(clamp(this.dot(q), -1, 1)));
  }
  rotateTowards(q, step) {
    let angle = this.angleTo(q);
    if (angle === 0)
      return this;
    let t = Math.min(1, step / angle);
    return this.slerp(q, t), this;
  }
  identity() {
    return this.set(0, 0, 0, 1);
  }
  invert() {
    return this.conjugate();
  }
  conjugate() {
    return this._x *= -1, this._y *= -1, this._z *= -1, this._onChangeCallback(), this;
  }
  dot(v) {
    return this._x * v._x + this._y * v._y + this._z * v._z + this._w * v._w;
  }
  lengthSq() {
    return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w;
  }
  length() {
    return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w);
  }
  normalize() {
    let l = this.length();
    return l === 0 ? (this._x = 0, this._y = 0, this._z = 0, this._w = 1) : (l = 1 / l, this._x = this._x * l, this._y = this._y * l, this._z = this._z * l, this._w = this._w * l), this._onChangeCallback(), this;
  }
  multiply(q, p) {
    return p !== void 0 ? (console.warn("THREE.Quaternion: .multiply() now only accepts one argument. Use .multiplyQuaternions( a, b ) instead."), this.multiplyQuaternions(q, p)) : this.multiplyQuaternions(this, q);
  }
  premultiply(q) {
    return this.multiplyQuaternions(q, this);
  }
  multiplyQuaternions(a, b) {
    let qax = a._x, qay = a._y, qaz = a._z, qaw = a._w, qbx = b._x, qby = b._y, qbz = b._z, qbw = b._w;
    return this._x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby, this._y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz, this._z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx, this._w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz, this._onChangeCallback(), this;
  }
  slerp(qb, t) {
    if (t === 0)
      return this;
    if (t === 1)
      return this.copy(qb);
    let x = this._x, y = this._y, z = this._z, w = this._w, cosHalfTheta = w * qb._w + x * qb._x + y * qb._y + z * qb._z;
    if (cosHalfTheta < 0 ? (this._w = -qb._w, this._x = -qb._x, this._y = -qb._y, this._z = -qb._z, cosHalfTheta = -cosHalfTheta) : this.copy(qb), cosHalfTheta >= 1)
      return this._w = w, this._x = x, this._y = y, this._z = z, this;
    let sqrSinHalfTheta = 1 - cosHalfTheta * cosHalfTheta;
    if (sqrSinHalfTheta <= Number.EPSILON) {
      let s = 1 - t;
      return this._w = s * w + t * this._w, this._x = s * x + t * this._x, this._y = s * y + t * this._y, this._z = s * z + t * this._z, this.normalize(), this._onChangeCallback(), this;
    }
    let sinHalfTheta = Math.sqrt(sqrSinHalfTheta), halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta), ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta, ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
    return this._w = w * ratioA + this._w * ratioB, this._x = x * ratioA + this._x * ratioB, this._y = y * ratioA + this._y * ratioB, this._z = z * ratioA + this._z * ratioB, this._onChangeCallback(), this;
  }
  slerpQuaternions(qa, qb, t) {
    this.copy(qa).slerp(qb, t);
  }
  equals(quaternion) {
    return quaternion._x === this._x && quaternion._y === this._y && quaternion._z === this._z && quaternion._w === this._w;
  }
  fromArray(array, offset = 0) {
    return this._x = array[offset], this._y = array[offset + 1], this._z = array[offset + 2], this._w = array[offset + 3], this._onChangeCallback(), this;
  }
  toArray(array = [], offset = 0) {
    return array[offset] = this._x, array[offset + 1] = this._y, array[offset + 2] = this._z, array[offset + 3] = this._w, array;
  }
  fromBufferAttribute(attribute, index) {
    return this._x = attribute.getX(index), this._y = attribute.getY(index), this._z = attribute.getZ(index), this._w = attribute.getW(index), this;
  }
  _onChange(callback) {
    return this._onChangeCallback = callback, this;
  }
  _onChangeCallback() {
  }
};
Quaternion.prototype.isQuaternion = !0;
var Vector3 = class {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x, this.y = y, this.z = z;
  }
  set(x, y, z) {
    return z === void 0 && (z = this.z), this.x = x, this.y = y, this.z = z, this;
  }
  setScalar(scalar) {
    return this.x = scalar, this.y = scalar, this.z = scalar, this;
  }
  setX(x) {
    return this.x = x, this;
  }
  setY(y) {
    return this.y = y, this;
  }
  setZ(z) {
    return this.z = z, this;
  }
  setComponent(index, value) {
    switch (index) {
      case 0:
        this.x = value;
        break;
      case 1:
        this.y = value;
        break;
      case 2:
        this.z = value;
        break;
      default:
        throw new Error("index is out of range: " + index);
    }
    return this;
  }
  getComponent(index) {
    switch (index) {
      case 0:
        return this.x;
      case 1:
        return this.y;
      case 2:
        return this.z;
      default:
        throw new Error("index is out of range: " + index);
    }
  }
  clone() {
    return new this.constructor(this.x, this.y, this.z);
  }
  copy(v) {
    return this.x = v.x, this.y = v.y, this.z = v.z, this;
  }
  add(v, w) {
    return w !== void 0 ? (console.warn("THREE.Vector3: .add() now only accepts one argument. Use .addVectors( a, b ) instead."), this.addVectors(v, w)) : (this.x += v.x, this.y += v.y, this.z += v.z, this);
  }
  addScalar(s) {
    return this.x += s, this.y += s, this.z += s, this;
  }
  addVectors(a, b) {
    return this.x = a.x + b.x, this.y = a.y + b.y, this.z = a.z + b.z, this;
  }
  addScaledVector(v, s) {
    return this.x += v.x * s, this.y += v.y * s, this.z += v.z * s, this;
  }
  sub(v, w) {
    return w !== void 0 ? (console.warn("THREE.Vector3: .sub() now only accepts one argument. Use .subVectors( a, b ) instead."), this.subVectors(v, w)) : (this.x -= v.x, this.y -= v.y, this.z -= v.z, this);
  }
  subScalar(s) {
    return this.x -= s, this.y -= s, this.z -= s, this;
  }
  subVectors(a, b) {
    return this.x = a.x - b.x, this.y = a.y - b.y, this.z = a.z - b.z, this;
  }
  multiply(v, w) {
    return w !== void 0 ? (console.warn("THREE.Vector3: .multiply() now only accepts one argument. Use .multiplyVectors( a, b ) instead."), this.multiplyVectors(v, w)) : (this.x *= v.x, this.y *= v.y, this.z *= v.z, this);
  }
  multiplyScalar(scalar) {
    return this.x *= scalar, this.y *= scalar, this.z *= scalar, this;
  }
  multiplyVectors(a, b) {
    return this.x = a.x * b.x, this.y = a.y * b.y, this.z = a.z * b.z, this;
  }
  applyEuler(euler) {
    return euler && euler.isEuler || console.error("THREE.Vector3: .applyEuler() now expects an Euler rotation rather than a Vector3 and order."), this.applyQuaternion(_quaternion$4.setFromEuler(euler));
  }
  applyAxisAngle(axis, angle) {
    return this.applyQuaternion(_quaternion$4.setFromAxisAngle(axis, angle));
  }
  applyMatrix3(m) {
    let x = this.x, y = this.y, z = this.z, e = m.elements;
    return this.x = e[0] * x + e[3] * y + e[6] * z, this.y = e[1] * x + e[4] * y + e[7] * z, this.z = e[2] * x + e[5] * y + e[8] * z, this;
  }
  applyNormalMatrix(m) {
    return this.applyMatrix3(m).normalize();
  }
  applyMatrix4(m) {
    let x = this.x, y = this.y, z = this.z, e = m.elements, w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    return this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w, this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w, this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w, this;
  }
  applyQuaternion(q) {
    let x = this.x, y = this.y, z = this.z, qx = q.x, qy = q.y, qz = q.z, qw = q.w, ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
    return this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy, this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz, this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx, this;
  }
  project(camera) {
    return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  }
  unproject(camera) {
    return this.applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld);
  }
  transformDirection(m) {
    let x = this.x, y = this.y, z = this.z, e = m.elements;
    return this.x = e[0] * x + e[4] * y + e[8] * z, this.y = e[1] * x + e[5] * y + e[9] * z, this.z = e[2] * x + e[6] * y + e[10] * z, this.normalize();
  }
  divide(v) {
    return this.x /= v.x, this.y /= v.y, this.z /= v.z, this;
  }
  divideScalar(scalar) {
    return this.multiplyScalar(1 / scalar);
  }
  min(v) {
    return this.x = Math.min(this.x, v.x), this.y = Math.min(this.y, v.y), this.z = Math.min(this.z, v.z), this;
  }
  max(v) {
    return this.x = Math.max(this.x, v.x), this.y = Math.max(this.y, v.y), this.z = Math.max(this.z, v.z), this;
  }
  clamp(min, max) {
    return this.x = Math.max(min.x, Math.min(max.x, this.x)), this.y = Math.max(min.y, Math.min(max.y, this.y)), this.z = Math.max(min.z, Math.min(max.z, this.z)), this;
  }
  clampScalar(minVal, maxVal) {
    return this.x = Math.max(minVal, Math.min(maxVal, this.x)), this.y = Math.max(minVal, Math.min(maxVal, this.y)), this.z = Math.max(minVal, Math.min(maxVal, this.z)), this;
  }
  clampLength(min, max) {
    let length = this.length();
    return this.divideScalar(length || 1).multiplyScalar(Math.max(min, Math.min(max, length)));
  }
  floor() {
    return this.x = Math.floor(this.x), this.y = Math.floor(this.y), this.z = Math.floor(this.z), this;
  }
  ceil() {
    return this.x = Math.ceil(this.x), this.y = Math.ceil(this.y), this.z = Math.ceil(this.z), this;
  }
  round() {
    return this.x = Math.round(this.x), this.y = Math.round(this.y), this.z = Math.round(this.z), this;
  }
  roundToZero() {
    return this.x = this.x < 0 ? Math.ceil(this.x) : Math.floor(this.x), this.y = this.y < 0 ? Math.ceil(this.y) : Math.floor(this.y), this.z = this.z < 0 ? Math.ceil(this.z) : Math.floor(this.z), this;
  }
  negate() {
    return this.x = -this.x, this.y = -this.y, this.z = -this.z, this;
  }
  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  manhattanLength() {
    return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z);
  }
  normalize() {
    return this.divideScalar(this.length() || 1);
  }
  setLength(length) {
    return this.normalize().multiplyScalar(length);
  }
  lerp(v, alpha) {
    return this.x += (v.x - this.x) * alpha, this.y += (v.y - this.y) * alpha, this.z += (v.z - this.z) * alpha, this;
  }
  lerpVectors(v1, v2, alpha) {
    return this.x = v1.x + (v2.x - v1.x) * alpha, this.y = v1.y + (v2.y - v1.y) * alpha, this.z = v1.z + (v2.z - v1.z) * alpha, this;
  }
  cross(v, w) {
    return w !== void 0 ? (console.warn("THREE.Vector3: .cross() now only accepts one argument. Use .crossVectors( a, b ) instead."), this.crossVectors(v, w)) : this.crossVectors(this, v);
  }
  crossVectors(a, b) {
    let ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    return this.x = ay * bz - az * by, this.y = az * bx - ax * bz, this.z = ax * by - ay * bx, this;
  }
  projectOnVector(v) {
    let denominator = v.lengthSq();
    if (denominator === 0)
      return this.set(0, 0, 0);
    let scalar = v.dot(this) / denominator;
    return this.copy(v).multiplyScalar(scalar);
  }
  projectOnPlane(planeNormal) {
    return _vector$c.copy(this).projectOnVector(planeNormal), this.sub(_vector$c);
  }
  reflect(normal) {
    return this.sub(_vector$c.copy(normal).multiplyScalar(2 * this.dot(normal)));
  }
  angleTo(v) {
    let denominator = Math.sqrt(this.lengthSq() * v.lengthSq());
    if (denominator === 0)
      return Math.PI / 2;
    let theta = this.dot(v) / denominator;
    return Math.acos(clamp(theta, -1, 1));
  }
  distanceTo(v) {
    return Math.sqrt(this.distanceToSquared(v));
  }
  distanceToSquared(v) {
    let dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }
  manhattanDistanceTo(v) {
    return Math.abs(this.x - v.x) + Math.abs(this.y - v.y) + Math.abs(this.z - v.z);
  }
  setFromSpherical(s) {
    return this.setFromSphericalCoords(s.radius, s.phi, s.theta);
  }
  setFromSphericalCoords(radius, phi, theta) {
    let sinPhiRadius = Math.sin(phi) * radius;
    return this.x = sinPhiRadius * Math.sin(theta), this.y = Math.cos(phi) * radius, this.z = sinPhiRadius * Math.cos(theta), this;
  }
  setFromCylindrical(c) {
    return this.setFromCylindricalCoords(c.radius, c.theta, c.y);
  }
  setFromCylindricalCoords(radius, theta, y) {
    return this.x = radius * Math.sin(theta), this.y = y, this.z = radius * Math.cos(theta), this;
  }
  setFromMatrixPosition(m) {
    let e = m.elements;
    return this.x = e[12], this.y = e[13], this.z = e[14], this;
  }
  setFromMatrixScale(m) {
    let sx = this.setFromMatrixColumn(m, 0).length(), sy = this.setFromMatrixColumn(m, 1).length(), sz = this.setFromMatrixColumn(m, 2).length();
    return this.x = sx, this.y = sy, this.z = sz, this;
  }
  setFromMatrixColumn(m, index) {
    return this.fromArray(m.elements, index * 4);
  }
  setFromMatrix3Column(m, index) {
    return this.fromArray(m.elements, index * 3);
  }
  equals(v) {
    return v.x === this.x && v.y === this.y && v.z === this.z;
  }
  fromArray(array, offset = 0) {
    return this.x = array[offset], this.y = array[offset + 1], this.z = array[offset + 2], this;
  }
  toArray(array = [], offset = 0) {
    return array[offset] = this.x, array[offset + 1] = this.y, array[offset + 2] = this.z, array;
  }
  fromBufferAttribute(attribute, index, offset) {
    return offset !== void 0 && console.warn("THREE.Vector3: offset has been removed from .fromBufferAttribute()."), this.x = attribute.getX(index), this.y = attribute.getY(index), this.z = attribute.getZ(index), this;
  }
  random() {
    return this.x = Math.random(), this.y = Math.random(), this.z = Math.random(), this;
  }
};
Vector3.prototype.isVector3 = !0;
var _vector$c = /* @__PURE__ */ new Vector3(), _quaternion$4 = /* @__PURE__ */ new Quaternion(), Box3 = class {
  constructor(min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) {
    this.min = min, this.max = max;
  }
  set(min, max) {
    return this.min.copy(min), this.max.copy(max), this;
  }
  setFromArray(array) {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0, l = array.length; i < l; i += 3) {
      let x = array[i], y = array[i + 1], z = array[i + 2];
      x < minX && (minX = x), y < minY && (minY = y), z < minZ && (minZ = z), x > maxX && (maxX = x), y > maxY && (maxY = y), z > maxZ && (maxZ = z);
    }
    return this.min.set(minX, minY, minZ), this.max.set(maxX, maxY, maxZ), this;
  }
  setFromBufferAttribute(attribute) {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0, l = attribute.count; i < l; i++) {
      let x = attribute.getX(i), y = attribute.getY(i), z = attribute.getZ(i);
      x < minX && (minX = x), y < minY && (minY = y), z < minZ && (minZ = z), x > maxX && (maxX = x), y > maxY && (maxY = y), z > maxZ && (maxZ = z);
    }
    return this.min.set(minX, minY, minZ), this.max.set(maxX, maxY, maxZ), this;
  }
  setFromPoints(points) {
    this.makeEmpty();
    for (let i = 0, il = points.length; i < il; i++)
      this.expandByPoint(points[i]);
    return this;
  }
  setFromCenterAndSize(center, size) {
    let halfSize = _vector$b.copy(size).multiplyScalar(0.5);
    return this.min.copy(center).sub(halfSize), this.max.copy(center).add(halfSize), this;
  }
  setFromObject(object) {
    return this.makeEmpty(), this.expandByObject(object);
  }
  clone() {
    return new this.constructor().copy(this);
  }
  copy(box) {
    return this.min.copy(box.min), this.max.copy(box.max), this;
  }
  makeEmpty() {
    return this.min.x = this.min.y = this.min.z = Infinity, this.max.x = this.max.y = this.max.z = -Infinity, this;
  }
  isEmpty() {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }
  getCenter(target) {
    return target === void 0 && (console.warn("THREE.Box3: .getCenter() target is now required"), target = new Vector3()), this.isEmpty() ? target.set(0, 0, 0) : target.addVectors(this.min, this.max).multiplyScalar(0.5);
  }
  getSize(target) {
    return target === void 0 && (console.warn("THREE.Box3: .getSize() target is now required"), target = new Vector3()), this.isEmpty() ? target.set(0, 0, 0) : target.subVectors(this.max, this.min);
  }
  expandByPoint(point) {
    return this.min.min(point), this.max.max(point), this;
  }
  expandByVector(vector) {
    return this.min.sub(vector), this.max.add(vector), this;
  }
  expandByScalar(scalar) {
    return this.min.addScalar(-scalar), this.max.addScalar(scalar), this;
  }
  expandByObject(object) {
    object.updateWorldMatrix(!1, !1);
    let geometry = object.geometry;
    geometry !== void 0 && (geometry.boundingBox === null && geometry.computeBoundingBox(), _box$3.copy(geometry.boundingBox), _box$3.applyMatrix4(object.matrixWorld), this.union(_box$3));
    let children = object.children;
    for (let i = 0, l = children.length; i < l; i++)
      this.expandByObject(children[i]);
    return this;
  }
  containsPoint(point) {
    return !(point.x < this.min.x || point.x > this.max.x || point.y < this.min.y || point.y > this.max.y || point.z < this.min.z || point.z > this.max.z);
  }
  containsBox(box) {
    return this.min.x <= box.min.x && box.max.x <= this.max.x && this.min.y <= box.min.y && box.max.y <= this.max.y && this.min.z <= box.min.z && box.max.z <= this.max.z;
  }
  getParameter(point, target) {
    return target === void 0 && (console.warn("THREE.Box3: .getParameter() target is now required"), target = new Vector3()), target.set((point.x - this.min.x) / (this.max.x - this.min.x), (point.y - this.min.y) / (this.max.y - this.min.y), (point.z - this.min.z) / (this.max.z - this.min.z));
  }
  intersectsBox(box) {
    return !(box.max.x < this.min.x || box.min.x > this.max.x || box.max.y < this.min.y || box.min.y > this.max.y || box.max.z < this.min.z || box.min.z > this.max.z);
  }
  intersectsSphere(sphere) {
    return this.clampPoint(sphere.center, _vector$b), _vector$b.distanceToSquared(sphere.center) <= sphere.radius * sphere.radius;
  }
  intersectsPlane(plane) {
    let min, max;
    return plane.normal.x > 0 ? (min = plane.normal.x * this.min.x, max = plane.normal.x * this.max.x) : (min = plane.normal.x * this.max.x, max = plane.normal.x * this.min.x), plane.normal.y > 0 ? (min += plane.normal.y * this.min.y, max += plane.normal.y * this.max.y) : (min += plane.normal.y * this.max.y, max += plane.normal.y * this.min.y), plane.normal.z > 0 ? (min += plane.normal.z * this.min.z, max += plane.normal.z * this.max.z) : (min += plane.normal.z * this.max.z, max += plane.normal.z * this.min.z), min <= -plane.constant && max >= -plane.constant;
  }
  intersectsTriangle(triangle) {
    if (this.isEmpty())
      return !1;
    this.getCenter(_center), _extents.subVectors(this.max, _center), _v0$2.subVectors(triangle.a, _center), _v1$7.subVectors(triangle.b, _center), _v2$3.subVectors(triangle.c, _center), _f0.subVectors(_v1$7, _v0$2), _f1.subVectors(_v2$3, _v1$7), _f2.subVectors(_v0$2, _v2$3);
    let axes = [
      0,
      -_f0.z,
      _f0.y,
      0,
      -_f1.z,
      _f1.y,
      0,
      -_f2.z,
      _f2.y,
      _f0.z,
      0,
      -_f0.x,
      _f1.z,
      0,
      -_f1.x,
      _f2.z,
      0,
      -_f2.x,
      -_f0.y,
      _f0.x,
      0,
      -_f1.y,
      _f1.x,
      0,
      -_f2.y,
      _f2.x,
      0
    ];
    return !satForAxes(axes, _v0$2, _v1$7, _v2$3, _extents) || (axes = [1, 0, 0, 0, 1, 0, 0, 0, 1], !satForAxes(axes, _v0$2, _v1$7, _v2$3, _extents)) ? !1 : (_triangleNormal.crossVectors(_f0, _f1), axes = [_triangleNormal.x, _triangleNormal.y, _triangleNormal.z], satForAxes(axes, _v0$2, _v1$7, _v2$3, _extents));
  }
  clampPoint(point, target) {
    return target === void 0 && (console.warn("THREE.Box3: .clampPoint() target is now required"), target = new Vector3()), target.copy(point).clamp(this.min, this.max);
  }
  distanceToPoint(point) {
    return _vector$b.copy(point).clamp(this.min, this.max).sub(point).length();
  }
  getBoundingSphere(target) {
    return target === void 0 && console.error("THREE.Box3: .getBoundingSphere() target is now required"), this.getCenter(target.center), target.radius = this.getSize(_vector$b).length() * 0.5, target;
  }
  intersect(box) {
    return this.min.max(box.min), this.max.min(box.max), this.isEmpty() && this.makeEmpty(), this;
  }
  union(box) {
    return this.min.min(box.min), this.max.max(box.max), this;
  }
  applyMatrix4(matrix) {
    return this.isEmpty() ? this : (_points[0].set(this.min.x, this.min.y, this.min.z).applyMatrix4(matrix), _points[1].set(this.min.x, this.min.y, this.max.z).applyMatrix4(matrix), _points[2].set(this.min.x, this.max.y, this.min.z).applyMatrix4(matrix), _points[3].set(this.min.x, this.max.y, this.max.z).applyMatrix4(matrix), _points[4].set(this.max.x, this.min.y, this.min.z).applyMatrix4(matrix), _points[5].set(this.max.x, this.min.y, this.max.z).applyMatrix4(matrix), _points[6].set(this.max.x, this.max.y, this.min.z).applyMatrix4(matrix), _points[7].set(this.max.x, this.max.y, this.max.z).applyMatrix4(matrix), this.setFromPoints(_points), this);
  }
  translate(offset) {
    return this.min.add(offset), this.max.add(offset), this;
  }
  equals(box) {
    return box.min.equals(this.min) && box.max.equals(this.max);
  }
};
Box3.prototype.isBox3 = !0;
var _points = [
  /* @__PURE__ */ new Vector3(),
  /* @__PURE__ */ new Vector3(),
  /* @__PURE__ */ new Vector3(),
  /* @__PURE__ */ new Vector3(),
  /* @__PURE__ */ new Vector3(),
  /* @__PURE__ */ new Vector3(),
  /* @__PURE__ */ new Vector3(),
  /* @__PURE__ */ new Vector3()
], _vector$b = /* @__PURE__ */ new Vector3(), _box$3 = /* @__PURE__ */ new Box3(), _v0$2 = /* @__PURE__ */ new Vector3(), _v1$7 = /* @__PURE__ */ new Vector3(), _v2$3 = /* @__PURE__ */ new Vector3(), _f0 = /* @__PURE__ */ new Vector3(), _f1 = /* @__PURE__ */ new Vector3(), _f2 = /* @__PURE__ */ new Vector3(), _center = /* @__PURE__ */ new Vector3(), _extents = /* @__PURE__ */ new Vector3(), _triangleNormal = /* @__PURE__ */ new Vector3(), _testAxis = /* @__PURE__ */ new Vector3();
function satForAxes(axes, v0, v1, v2, extents) {
  for (let i = 0, j = axes.length - 3; i <= j; i += 3) {
    _testAxis.fromArray(axes, i);
    let r = extents.x * Math.abs(_testAxis.x) + extents.y * Math.abs(_testAxis.y) + extents.z * Math.abs(_testAxis.z), p0 = v0.dot(_testAxis), p1 = v1.dot(_testAxis), p2 = v2.dot(_testAxis);
    if (Math.max(-Math.max(p0, p1, p2), Math.min(p0, p1, p2)) > r)
      return !1;
  }
  return !0;
}
var _box$2 = /* @__PURE__ */ new Box3(), _v1$6 = /* @__PURE__ */ new Vector3(), _toFarthestPoint = /* @__PURE__ */ new Vector3(), _toPoint = /* @__PURE__ */ new Vector3(), Sphere = class {
  constructor(center = new Vector3(), radius = -1) {
    this.center = center, this.radius = radius;
  }
  set(center, radius) {
    return this.center.copy(center), this.radius = radius, this;
  }
  setFromPoints(points, optionalCenter) {
    let center = this.center;
    optionalCenter !== void 0 ? center.copy(optionalCenter) : _box$2.setFromPoints(points).getCenter(center);
    let maxRadiusSq = 0;
    for (let i = 0, il = points.length; i < il; i++)
      maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(points[i]));
    return this.radius = Math.sqrt(maxRadiusSq), this;
  }
  copy(sphere) {
    return this.center.copy(sphere.center), this.radius = sphere.radius, this;
  }
  isEmpty() {
    return this.radius < 0;
  }
  makeEmpty() {
    return this.center.set(0, 0, 0), this.radius = -1, this;
  }
  containsPoint(point) {
    return point.distanceToSquared(this.center) <= this.radius * this.radius;
  }
  distanceToPoint(point) {
    return point.distanceTo(this.center) - this.radius;
  }
  intersectsSphere(sphere) {
    let radiusSum = this.radius + sphere.radius;
    return sphere.center.distanceToSquared(this.center) <= radiusSum * radiusSum;
  }
  intersectsBox(box) {
    return box.intersectsSphere(this);
  }
  intersectsPlane(plane) {
    return Math.abs(plane.distanceToPoint(this.center)) <= this.radius;
  }
  clampPoint(point, target) {
    let deltaLengthSq = this.center.distanceToSquared(point);
    return target === void 0 && (console.warn("THREE.Sphere: .clampPoint() target is now required"), target = new Vector3()), target.copy(point), deltaLengthSq > this.radius * this.radius && (target.sub(this.center).normalize(), target.multiplyScalar(this.radius).add(this.center)), target;
  }
  getBoundingBox(target) {
    return target === void 0 && (console.warn("THREE.Sphere: .getBoundingBox() target is now required"), target = new Box3()), this.isEmpty() ? (target.makeEmpty(), target) : (target.set(this.center, this.center), target.expandByScalar(this.radius), target);
  }
  applyMatrix4(matrix) {
    return this.center.applyMatrix4(matrix), this.radius = this.radius * matrix.getMaxScaleOnAxis(), this;
  }
  translate(offset) {
    return this.center.add(offset), this;
  }
  expandByPoint(point) {
    _toPoint.subVectors(point, this.center);
    let lengthSq = _toPoint.lengthSq();
    if (lengthSq > this.radius * this.radius) {
      let length = Math.sqrt(lengthSq), missingRadiusHalf = (length - this.radius) * 0.5;
      this.center.add(_toPoint.multiplyScalar(missingRadiusHalf / length)), this.radius += missingRadiusHalf;
    }
    return this;
  }
  union(sphere) {
    return _toFarthestPoint.subVectors(sphere.center, this.center).normalize().multiplyScalar(sphere.radius), this.expandByPoint(_v1$6.copy(sphere.center).add(_toFarthestPoint)), this.expandByPoint(_v1$6.copy(sphere.center).sub(_toFarthestPoint)), this;
  }
  equals(sphere) {
    return sphere.center.equals(this.center) && sphere.radius === this.radius;
  }
  clone() {
    return new this.constructor().copy(this);
  }
}, _vector$a = /* @__PURE__ */ new Vector3(), _segCenter = /* @__PURE__ */ new Vector3(), _segDir = /* @__PURE__ */ new Vector3(), _diff = /* @__PURE__ */ new Vector3(), _edge1 = /* @__PURE__ */ new Vector3(), _edge2 = /* @__PURE__ */ new Vector3(), _normal$1 = /* @__PURE__ */ new Vector3(), Ray = class {
  constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) {
    this.origin = origin, this.direction = direction;
  }
  set(origin, direction) {
    return this.origin.copy(origin), this.direction.copy(direction), this;
  }
  copy(ray) {
    return this.origin.copy(ray.origin), this.direction.copy(ray.direction), this;
  }
  at(t, target) {
    return target === void 0 && (console.warn("THREE.Ray: .at() target is now required"), target = new Vector3()), target.copy(this.direction).multiplyScalar(t).add(this.origin);
  }
  lookAt(v) {
    return this.direction.copy(v).sub(this.origin).normalize(), this;
  }
  recast(t) {
    return this.origin.copy(this.at(t, _vector$a)), this;
  }
  closestPointToPoint(point, target) {
    target === void 0 && (console.warn("THREE.Ray: .closestPointToPoint() target is now required"), target = new Vector3()), target.subVectors(point, this.origin);
    let directionDistance = target.dot(this.direction);
    return directionDistance < 0 ? target.copy(this.origin) : target.copy(this.direction).multiplyScalar(directionDistance).add(this.origin);
  }
  distanceToPoint(point) {
    return Math.sqrt(this.distanceSqToPoint(point));
  }
  distanceSqToPoint(point) {
    let directionDistance = _vector$a.subVectors(point, this.origin).dot(this.direction);
    return directionDistance < 0 ? this.origin.distanceToSquared(point) : (_vector$a.copy(this.direction).multiplyScalar(directionDistance).add(this.origin), _vector$a.distanceToSquared(point));
  }
  distanceSqToSegment(v0, v1, optionalPointOnRay, optionalPointOnSegment) {
    _segCenter.copy(v0).add(v1).multiplyScalar(0.5), _segDir.copy(v1).sub(v0).normalize(), _diff.copy(this.origin).sub(_segCenter);
    let segExtent = v0.distanceTo(v1) * 0.5, a01 = -this.direction.dot(_segDir), b0 = _diff.dot(this.direction), b1 = -_diff.dot(_segDir), c = _diff.lengthSq(), det = Math.abs(1 - a01 * a01), s0, s1, sqrDist, extDet;
    if (det > 0)
      if (s0 = a01 * b1 - b0, s1 = a01 * b0 - b1, extDet = segExtent * det, s0 >= 0)
        if (s1 >= -extDet)
          if (s1 <= extDet) {
            let invDet = 1 / det;
            s0 *= invDet, s1 *= invDet, sqrDist = s0 * (s0 + a01 * s1 + 2 * b0) + s1 * (a01 * s0 + s1 + 2 * b1) + c;
          } else
            s1 = segExtent, s0 = Math.max(0, -(a01 * s1 + b0)), sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
        else
          s1 = -segExtent, s0 = Math.max(0, -(a01 * s1 + b0)), sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
      else
        s1 <= -extDet ? (s0 = Math.max(0, -(-a01 * segExtent + b0)), s1 = s0 > 0 ? -segExtent : Math.min(Math.max(-segExtent, -b1), segExtent), sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c) : s1 <= extDet ? (s0 = 0, s1 = Math.min(Math.max(-segExtent, -b1), segExtent), sqrDist = s1 * (s1 + 2 * b1) + c) : (s0 = Math.max(0, -(a01 * segExtent + b0)), s1 = s0 > 0 ? segExtent : Math.min(Math.max(-segExtent, -b1), segExtent), sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c);
    else
      s1 = a01 > 0 ? -segExtent : segExtent, s0 = Math.max(0, -(a01 * s1 + b0)), sqrDist = -s0 * s0 + s1 * (s1 + 2 * b1) + c;
    return optionalPointOnRay && optionalPointOnRay.copy(this.direction).multiplyScalar(s0).add(this.origin), optionalPointOnSegment && optionalPointOnSegment.copy(_segDir).multiplyScalar(s1).add(_segCenter), sqrDist;
  }
  intersectSphere(sphere, target) {
    _vector$a.subVectors(sphere.center, this.origin);
    let tca = _vector$a.dot(this.direction), d2 = _vector$a.dot(_vector$a) - tca * tca, radius2 = sphere.radius * sphere.radius;
    if (d2 > radius2)
      return null;
    let thc = Math.sqrt(radius2 - d2), t0 = tca - thc, t1 = tca + thc;
    return t0 < 0 && t1 < 0 ? null : t0 < 0 ? this.at(t1, target) : this.at(t0, target);
  }
  intersectsSphere(sphere) {
    return this.distanceSqToPoint(sphere.center) <= sphere.radius * sphere.radius;
  }
  distanceToPlane(plane) {
    let denominator = plane.normal.dot(this.direction);
    if (denominator === 0)
      return plane.distanceToPoint(this.origin) === 0 ? 0 : null;
    let t = -(this.origin.dot(plane.normal) + plane.constant) / denominator;
    return t >= 0 ? t : null;
  }
  intersectPlane(plane, target) {
    let t = this.distanceToPlane(plane);
    return t === null ? null : this.at(t, target);
  }
  intersectsPlane(plane) {
    let distToPoint = plane.distanceToPoint(this.origin);
    return distToPoint === 0 || plane.normal.dot(this.direction) * distToPoint < 0;
  }
  intersectBox(box, target) {
    let tmin, tmax, tymin, tymax, tzmin, tzmax, invdirx = 1 / this.direction.x, invdiry = 1 / this.direction.y, invdirz = 1 / this.direction.z, origin = this.origin;
    return invdirx >= 0 ? (tmin = (box.min.x - origin.x) * invdirx, tmax = (box.max.x - origin.x) * invdirx) : (tmin = (box.max.x - origin.x) * invdirx, tmax = (box.min.x - origin.x) * invdirx), invdiry >= 0 ? (tymin = (box.min.y - origin.y) * invdiry, tymax = (box.max.y - origin.y) * invdiry) : (tymin = (box.max.y - origin.y) * invdiry, tymax = (box.min.y - origin.y) * invdiry), tmin > tymax || tymin > tmax || ((tymin > tmin || tmin !== tmin) && (tmin = tymin), (tymax < tmax || tmax !== tmax) && (tmax = tymax), invdirz >= 0 ? (tzmin = (box.min.z - origin.z) * invdirz, tzmax = (box.max.z - origin.z) * invdirz) : (tzmin = (box.max.z - origin.z) * invdirz, tzmax = (box.min.z - origin.z) * invdirz), tmin > tzmax || tzmin > tmax) || ((tzmin > tmin || tmin !== tmin) && (tmin = tzmin), (tzmax < tmax || tmax !== tmax) && (tmax = tzmax), tmax < 0) ? null : this.at(tmin >= 0 ? tmin : tmax, target);
  }
  intersectsBox(box) {
    return this.intersectBox(box, _vector$a) !== null;
  }
  intersectTriangle(a, b, c, backfaceCulling, target) {
    _edge1.subVectors(b, a), _edge2.subVectors(c, a), _normal$1.crossVectors(_edge1, _edge2);
    let DdN = this.direction.dot(_normal$1), sign2;
    if (DdN > 0) {
      if (backfaceCulling)
        return null;
      sign2 = 1;
    } else if (DdN < 0)
      sign2 = -1, DdN = -DdN;
    else
      return null;
    _diff.subVectors(this.origin, a);
    let DdQxE2 = sign2 * this.direction.dot(_edge2.crossVectors(_diff, _edge2));
    if (DdQxE2 < 0)
      return null;
    let DdE1xQ = sign2 * this.direction.dot(_edge1.cross(_diff));
    if (DdE1xQ < 0 || DdQxE2 + DdE1xQ > DdN)
      return null;
    let QdN = -sign2 * _diff.dot(_normal$1);
    return QdN < 0 ? null : this.at(QdN / DdN, target);
  }
  applyMatrix4(matrix4) {
    return this.origin.applyMatrix4(matrix4), this.direction.transformDirection(matrix4), this;
  }
  equals(ray) {
    return ray.origin.equals(this.origin) && ray.direction.equals(this.direction);
  }
  clone() {
    return new this.constructor().copy(this);
  }
}, Matrix4 = class {
  constructor() {
    this.elements = [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1
    ], arguments.length > 0 && console.error("THREE.Matrix4: the constructor no longer reads arguments. use .set() instead.");
  }
  set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44) {
    let te = this.elements;
    return te[0] = n11, te[4] = n12, te[8] = n13, te[12] = n14, te[1] = n21, te[5] = n22, te[9] = n23, te[13] = n24, te[2] = n31, te[6] = n32, te[10] = n33, te[14] = n34, te[3] = n41, te[7] = n42, te[11] = n43, te[15] = n44, this;
  }
  identity() {
    return this.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1), this;
  }
  clone() {
    return new Matrix4().fromArray(this.elements);
  }
  copy(m) {
    let te = this.elements, me = m.elements;
    return te[0] = me[0], te[1] = me[1], te[2] = me[2], te[3] = me[3], te[4] = me[4], te[5] = me[5], te[6] = me[6], te[7] = me[7], te[8] = me[8], te[9] = me[9], te[10] = me[10], te[11] = me[11], te[12] = me[12], te[13] = me[13], te[14] = me[14], te[15] = me[15], this;
  }
  copyPosition(m) {
    let te = this.elements, me = m.elements;
    return te[12] = me[12], te[13] = me[13], te[14] = me[14], this;
  }
  setFromMatrix3(m) {
    let me = m.elements;
    return this.set(me[0], me[3], me[6], 0, me[1], me[4], me[7], 0, me[2], me[5], me[8], 0, 0, 0, 0, 1), this;
  }
  extractBasis(xAxis, yAxis, zAxis) {
    return xAxis.setFromMatrixColumn(this, 0), yAxis.setFromMatrixColumn(this, 1), zAxis.setFromMatrixColumn(this, 2), this;
  }
  makeBasis(xAxis, yAxis, zAxis) {
    return this.set(xAxis.x, yAxis.x, zAxis.x, 0, xAxis.y, yAxis.y, zAxis.y, 0, xAxis.z, yAxis.z, zAxis.z, 0, 0, 0, 0, 1), this;
  }
  extractRotation(m) {
    let te = this.elements, me = m.elements, scaleX = 1 / _v1$5.setFromMatrixColumn(m, 0).length(), scaleY = 1 / _v1$5.setFromMatrixColumn(m, 1).length(), scaleZ = 1 / _v1$5.setFromMatrixColumn(m, 2).length();
    return te[0] = me[0] * scaleX, te[1] = me[1] * scaleX, te[2] = me[2] * scaleX, te[3] = 0, te[4] = me[4] * scaleY, te[5] = me[5] * scaleY, te[6] = me[6] * scaleY, te[7] = 0, te[8] = me[8] * scaleZ, te[9] = me[9] * scaleZ, te[10] = me[10] * scaleZ, te[11] = 0, te[12] = 0, te[13] = 0, te[14] = 0, te[15] = 1, this;
  }
  makeRotationFromEuler(euler) {
    euler && euler.isEuler || console.error("THREE.Matrix4: .makeRotationFromEuler() now expects a Euler rotation rather than a Vector3 and order.");
    let te = this.elements, x = euler.x, y = euler.y, z = euler.z, a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
    if (euler.order === "XYZ") {
      let ae = a * e, af = a * f, be = b * e, bf = b * f;
      te[0] = c * e, te[4] = -c * f, te[8] = d, te[1] = af + be * d, te[5] = ae - bf * d, te[9] = -b * c, te[2] = bf - ae * d, te[6] = be + af * d, te[10] = a * c;
    } else if (euler.order === "YXZ") {
      let ce = c * e, cf = c * f, de = d * e, df = d * f;
      te[0] = ce + df * b, te[4] = de * b - cf, te[8] = a * d, te[1] = a * f, te[5] = a * e, te[9] = -b, te[2] = cf * b - de, te[6] = df + ce * b, te[10] = a * c;
    } else if (euler.order === "ZXY") {
      let ce = c * e, cf = c * f, de = d * e, df = d * f;
      te[0] = ce - df * b, te[4] = -a * f, te[8] = de + cf * b, te[1] = cf + de * b, te[5] = a * e, te[9] = df - ce * b, te[2] = -a * d, te[6] = b, te[10] = a * c;
    } else if (euler.order === "ZYX") {
      let ae = a * e, af = a * f, be = b * e, bf = b * f;
      te[0] = c * e, te[4] = be * d - af, te[8] = ae * d + bf, te[1] = c * f, te[5] = bf * d + ae, te[9] = af * d - be, te[2] = -d, te[6] = b * c, te[10] = a * c;
    } else if (euler.order === "YZX") {
      let ac = a * c, ad = a * d, bc = b * c, bd = b * d;
      te[0] = c * e, te[4] = bd - ac * f, te[8] = bc * f + ad, te[1] = f, te[5] = a * e, te[9] = -b * e, te[2] = -d * e, te[6] = ad * f + bc, te[10] = ac - bd * f;
    } else if (euler.order === "XZY") {
      let ac = a * c, ad = a * d, bc = b * c, bd = b * d;
      te[0] = c * e, te[4] = -f, te[8] = d * e, te[1] = ac * f + bd, te[5] = a * e, te[9] = ad * f - bc, te[2] = bc * f - ad, te[6] = b * e, te[10] = bd * f + ac;
    }
    return te[3] = 0, te[7] = 0, te[11] = 0, te[12] = 0, te[13] = 0, te[14] = 0, te[15] = 1, this;
  }
  makeRotationFromQuaternion(q) {
    return this.compose(_zero, q, _one);
  }
  lookAt(eye, target, up) {
    let te = this.elements;
    return _z.subVectors(eye, target), _z.lengthSq() === 0 && (_z.z = 1), _z.normalize(), _x.crossVectors(up, _z), _x.lengthSq() === 0 && (Math.abs(up.z) === 1 ? _z.x += 1e-4 : _z.z += 1e-4, _z.normalize(), _x.crossVectors(up, _z)), _x.normalize(), _y.crossVectors(_z, _x), te[0] = _x.x, te[4] = _y.x, te[8] = _z.x, te[1] = _x.y, te[5] = _y.y, te[9] = _z.y, te[2] = _x.z, te[6] = _y.z, te[10] = _z.z, this;
  }
  multiply(m, n) {
    return n !== void 0 ? (console.warn("THREE.Matrix4: .multiply() now only accepts one argument. Use .multiplyMatrices( a, b ) instead."), this.multiplyMatrices(m, n)) : this.multiplyMatrices(this, m);
  }
  premultiply(m) {
    return this.multiplyMatrices(m, this);
  }
  multiplyMatrices(a, b) {
    let ae = a.elements, be = b.elements, te = this.elements, a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12], a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13], a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14], a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15], b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12], b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13], b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14], b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
    return te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41, te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42, te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43, te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44, te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41, te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42, te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43, te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44, te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41, te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42, te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43, te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44, te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41, te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42, te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43, te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44, this;
  }
  multiplyScalar(s) {
    let te = this.elements;
    return te[0] *= s, te[4] *= s, te[8] *= s, te[12] *= s, te[1] *= s, te[5] *= s, te[9] *= s, te[13] *= s, te[2] *= s, te[6] *= s, te[10] *= s, te[14] *= s, te[3] *= s, te[7] *= s, te[11] *= s, te[15] *= s, this;
  }
  determinant() {
    let te = this.elements, n11 = te[0], n12 = te[4], n13 = te[8], n14 = te[12], n21 = te[1], n22 = te[5], n23 = te[9], n24 = te[13], n31 = te[2], n32 = te[6], n33 = te[10], n34 = te[14], n41 = te[3], n42 = te[7], n43 = te[11], n44 = te[15];
    return n41 * (+n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) + n42 * (+n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) + n43 * (+n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) + n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31);
  }
  transpose() {
    let te = this.elements, tmp2;
    return tmp2 = te[1], te[1] = te[4], te[4] = tmp2, tmp2 = te[2], te[2] = te[8], te[8] = tmp2, tmp2 = te[6], te[6] = te[9], te[9] = tmp2, tmp2 = te[3], te[3] = te[12], te[12] = tmp2, tmp2 = te[7], te[7] = te[13], te[13] = tmp2, tmp2 = te[11], te[11] = te[14], te[14] = tmp2, this;
  }
  setPosition(x, y, z) {
    let te = this.elements;
    return x.isVector3 ? (te[12] = x.x, te[13] = x.y, te[14] = x.z) : (te[12] = x, te[13] = y, te[14] = z), this;
  }
  invert() {
    let te = this.elements, n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3], n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7], n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11], n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15], t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44, t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44, t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44, t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34, det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if (det === 0)
      return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    let detInv = 1 / det;
    return te[0] = t11 * detInv, te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * detInv, te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * detInv, te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * detInv, te[4] = t12 * detInv, te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * detInv, te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * detInv, te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * detInv, te[8] = t13 * detInv, te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * detInv, te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * detInv, te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * detInv, te[12] = t14 * detInv, te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * detInv, te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * detInv, te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * detInv, this;
  }
  scale(v) {
    let te = this.elements, x = v.x, y = v.y, z = v.z;
    return te[0] *= x, te[4] *= y, te[8] *= z, te[1] *= x, te[5] *= y, te[9] *= z, te[2] *= x, te[6] *= y, te[10] *= z, te[3] *= x, te[7] *= y, te[11] *= z, this;
  }
  getMaxScaleOnAxis() {
    let te = this.elements, scaleXSq = te[0] * te[0] + te[1] * te[1] + te[2] * te[2], scaleYSq = te[4] * te[4] + te[5] * te[5] + te[6] * te[6], scaleZSq = te[8] * te[8] + te[9] * te[9] + te[10] * te[10];
    return Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
  }
  makeTranslation(x, y, z) {
    return this.set(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1), this;
  }
  makeRotationX(theta) {
    let c = Math.cos(theta), s = Math.sin(theta);
    return this.set(1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1), this;
  }
  makeRotationY(theta) {
    let c = Math.cos(theta), s = Math.sin(theta);
    return this.set(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1), this;
  }
  makeRotationZ(theta) {
    let c = Math.cos(theta), s = Math.sin(theta);
    return this.set(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1), this;
  }
  makeRotationAxis(axis, angle) {
    let c = Math.cos(angle), s = Math.sin(angle), t = 1 - c, x = axis.x, y = axis.y, z = axis.z, tx = t * x, ty = t * y;
    return this.set(tx * x + c, tx * y - s * z, tx * z + s * y, 0, tx * y + s * z, ty * y + c, ty * z - s * x, 0, tx * z - s * y, ty * z + s * x, t * z * z + c, 0, 0, 0, 0, 1), this;
  }
  makeScale(x, y, z) {
    return this.set(x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1), this;
  }
  makeShear(xy, xz, yx, yz, zx, zy) {
    return this.set(1, yx, zx, 0, xy, 1, zy, 0, xz, yz, 1, 0, 0, 0, 0, 1), this;
  }
  compose(position, quaternion, scale) {
    let te = this.elements, x = quaternion._x, y = quaternion._y, z = quaternion._z, w = quaternion._w, x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2, sx = scale.x, sy = scale.y, sz = scale.z;
    return te[0] = (1 - (yy + zz)) * sx, te[1] = (xy + wz) * sx, te[2] = (xz - wy) * sx, te[3] = 0, te[4] = (xy - wz) * sy, te[5] = (1 - (xx + zz)) * sy, te[6] = (yz + wx) * sy, te[7] = 0, te[8] = (xz + wy) * sz, te[9] = (yz - wx) * sz, te[10] = (1 - (xx + yy)) * sz, te[11] = 0, te[12] = position.x, te[13] = position.y, te[14] = position.z, te[15] = 1, this;
  }
  decompose(position, quaternion, scale) {
    let te = this.elements, sx = _v1$5.set(te[0], te[1], te[2]).length(), sy = _v1$5.set(te[4], te[5], te[6]).length(), sz = _v1$5.set(te[8], te[9], te[10]).length();
    this.determinant() < 0 && (sx = -sx), position.x = te[12], position.y = te[13], position.z = te[14], _m1$2.copy(this);
    let invSX = 1 / sx, invSY = 1 / sy, invSZ = 1 / sz;
    return _m1$2.elements[0] *= invSX, _m1$2.elements[1] *= invSX, _m1$2.elements[2] *= invSX, _m1$2.elements[4] *= invSY, _m1$2.elements[5] *= invSY, _m1$2.elements[6] *= invSY, _m1$2.elements[8] *= invSZ, _m1$2.elements[9] *= invSZ, _m1$2.elements[10] *= invSZ, quaternion.setFromRotationMatrix(_m1$2), scale.x = sx, scale.y = sy, scale.z = sz, this;
  }
  makePerspective(left, right, top, bottom, near, far) {
    far === void 0 && console.warn("THREE.Matrix4: .makePerspective() has been redefined and has a new signature. Please check the docs.");
    let te = this.elements, x = 2 * near / (right - left), y = 2 * near / (top - bottom), a = (right + left) / (right - left), b = (top + bottom) / (top - bottom), c = -(far + near) / (far - near), d = -2 * far * near / (far - near);
    return te[0] = x, te[4] = 0, te[8] = a, te[12] = 0, te[1] = 0, te[5] = y, te[9] = b, te[13] = 0, te[2] = 0, te[6] = 0, te[10] = c, te[14] = d, te[3] = 0, te[7] = 0, te[11] = -1, te[15] = 0, this;
  }
  makeOrthographic(left, right, top, bottom, near, far) {
    let te = this.elements, w = 1 / (right - left), h = 1 / (top - bottom), p = 1 / (far - near), x = (right + left) * w, y = (top + bottom) * h, z = (far + near) * p;
    return te[0] = 2 * w, te[4] = 0, te[8] = 0, te[12] = -x, te[1] = 0, te[5] = 2 * h, te[9] = 0, te[13] = -y, te[2] = 0, te[6] = 0, te[10] = -2 * p, te[14] = -z, te[3] = 0, te[7] = 0, te[11] = 0, te[15] = 1, this;
  }
  equals(matrix) {
    let te = this.elements, me = matrix.elements;
    for (let i = 0; i < 16; i++)
      if (te[i] !== me[i])
        return !1;
    return !0;
  }
  fromArray(array, offset = 0) {
    for (let i = 0; i < 16; i++)
      this.elements[i] = array[i + offset];
    return this;
  }
  toArray(array = [], offset = 0) {
    let te = this.elements;
    return array[offset] = te[0], array[offset + 1] = te[1], array[offset + 2] = te[2], array[offset + 3] = te[3], array[offset + 4] = te[4], array[offset + 5] = te[5], array[offset + 6] = te[6], array[offset + 7] = te[7], array[offset + 8] = te[8], array[offset + 9] = te[9], array[offset + 10] = te[10], array[offset + 11] = te[11], array[offset + 12] = te[12], array[offset + 13] = te[13], array[offset + 14] = te[14], array[offset + 15] = te[15], array;
  }
};
Matrix4.prototype.isMatrix4 = !0;
var _v1$5 = /* @__PURE__ */ new Vector3(), _m1$2 = /* @__PURE__ */ new Matrix4(), _zero = /* @__PURE__ */ new Vector3(0, 0, 0), _one = /* @__PURE__ */ new Vector3(1, 1, 1), _x = /* @__PURE__ */ new Vector3(), _y = /* @__PURE__ */ new Vector3(), _z = /* @__PURE__ */ new Vector3(), _matrix$1 = /* @__PURE__ */ new Matrix4(), _quaternion$3 = /* @__PURE__ */ new Quaternion(), Euler = class {
  constructor(x = 0, y = 0, z = 0, order = Euler.DefaultOrder) {
    this._x = x, this._y = y, this._z = z, this._order = order;
  }
  get x() {
    return this._x;
  }
  set x(value) {
    this._x = value, this._onChangeCallback();
  }
  get y() {
    return this._y;
  }
  set y(value) {
    this._y = value, this._onChangeCallback();
  }
  get z() {
    return this._z;
  }
  set z(value) {
    this._z = value, this._onChangeCallback();
  }
  get order() {
    return this._order;
  }
  set order(value) {
    this._order = value, this._onChangeCallback();
  }
  set(x, y, z, order) {
    return this._x = x, this._y = y, this._z = z, this._order = order || this._order, this._onChangeCallback(), this;
  }
  clone() {
    return new this.constructor(this._x, this._y, this._z, this._order);
  }
  copy(euler) {
    return this._x = euler._x, this._y = euler._y, this._z = euler._z, this._order = euler._order, this._onChangeCallback(), this;
  }
  setFromRotationMatrix(m, order, update) {
    let te = m.elements, m11 = te[0], m12 = te[4], m13 = te[8], m21 = te[1], m22 = te[5], m23 = te[9], m31 = te[2], m32 = te[6], m33 = te[10];
    switch (order = order || this._order, order) {
      case "XYZ":
        this._y = Math.asin(clamp(m13, -1, 1)), Math.abs(m13) < 0.9999999 ? (this._x = Math.atan2(-m23, m33), this._z = Math.atan2(-m12, m11)) : (this._x = Math.atan2(m32, m22), this._z = 0);
        break;
      case "YXZ":
        this._x = Math.asin(-clamp(m23, -1, 1)), Math.abs(m23) < 0.9999999 ? (this._y = Math.atan2(m13, m33), this._z = Math.atan2(m21, m22)) : (this._y = Math.atan2(-m31, m11), this._z = 0);
        break;
      case "ZXY":
        this._x = Math.asin(clamp(m32, -1, 1)), Math.abs(m32) < 0.9999999 ? (this._y = Math.atan2(-m31, m33), this._z = Math.atan2(-m12, m22)) : (this._y = 0, this._z = Math.atan2(m21, m11));
        break;
      case "ZYX":
        this._y = Math.asin(-clamp(m31, -1, 1)), Math.abs(m31) < 0.9999999 ? (this._x = Math.atan2(m32, m33), this._z = Math.atan2(m21, m11)) : (this._x = 0, this._z = Math.atan2(-m12, m22));
        break;
      case "YZX":
        this._z = Math.asin(clamp(m21, -1, 1)), Math.abs(m21) < 0.9999999 ? (this._x = Math.atan2(-m23, m22), this._y = Math.atan2(-m31, m11)) : (this._x = 0, this._y = Math.atan2(m13, m33));
        break;
      case "XZY":
        this._z = Math.asin(-clamp(m12, -1, 1)), Math.abs(m12) < 0.9999999 ? (this._x = Math.atan2(m32, m22), this._y = Math.atan2(m13, m11)) : (this._x = Math.atan2(-m23, m33), this._y = 0);
        break;
      default:
        console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: " + order);
    }
    return this._order = order, update !== !1 && this._onChangeCallback(), this;
  }
  setFromQuaternion(q, order, update) {
    return _matrix$1.makeRotationFromQuaternion(q), this.setFromRotationMatrix(_matrix$1, order, update);
  }
  setFromVector3(v, order) {
    return this.set(v.x, v.y, v.z, order || this._order);
  }
  reorder(newOrder) {
    return _quaternion$3.setFromEuler(this), this.setFromQuaternion(_quaternion$3, newOrder);
  }
  equals(euler) {
    return euler._x === this._x && euler._y === this._y && euler._z === this._z && euler._order === this._order;
  }
  fromArray(array) {
    return this._x = array[0], this._y = array[1], this._z = array[2], array[3] !== void 0 && (this._order = array[3]), this._onChangeCallback(), this;
  }
  toArray(array = [], offset = 0) {
    return array[offset] = this._x, array[offset + 1] = this._y, array[offset + 2] = this._z, array[offset + 3] = this._order, array;
  }
  toVector3(optionalResult) {
    return optionalResult ? optionalResult.set(this._x, this._y, this._z) : new Vector3(this._x, this._y, this._z);
  }
  _onChange(callback) {
    return this._onChangeCallback = callback, this;
  }
  _onChangeCallback() {
  }
};
Euler.prototype.isEuler = !0;
Euler.DefaultOrder = "XYZ";
Euler.RotationOrders = ["XYZ", "YZX", "ZXY", "XZY", "YXZ", "ZYX"];
var Layers = class {
  constructor() {
    this.mask = 1 | 0;
  }
  set(channel) {
    this.mask = 1 << channel | 0;
  }
  enable(channel) {
    this.mask |= 1 << channel | 0;
  }
  enableAll() {
    this.mask = 4294967295 | 0;
  }
  toggle(channel) {
    this.mask ^= 1 << channel | 0;
  }
  disable(channel) {
    this.mask &= ~(1 << channel | 0);
  }
  disableAll() {
    this.mask = 0;
  }
  test(layers) {
    return (this.mask & layers.mask) != 0;
  }
}, _object3DId = 0, _v1$4 = /* @__PURE__ */ new Vector3(), _q1 = /* @__PURE__ */ new Quaternion(), _m1$1 = /* @__PURE__ */ new Matrix4(), _target = /* @__PURE__ */ new Vector3(), _position$3 = /* @__PURE__ */ new Vector3(), _scale$2 = /* @__PURE__ */ new Vector3(), _quaternion$2 = /* @__PURE__ */ new Quaternion(), _xAxis = /* @__PURE__ */ new Vector3(1, 0, 0), _yAxis = /* @__PURE__ */ new Vector3(0, 1, 0), _zAxis = /* @__PURE__ */ new Vector3(0, 0, 1), _addedEvent = { type: "added" }, _removedEvent = { type: "removed" }, Object3D = class extends EventDispatcher {
  constructor() {
    super();
    Object.defineProperty(this, "id", { value: _object3DId++ }), this.uuid = generateUUID(), this.name = "", this.type = "Object3D", this.parent = null, this.children = [], this.up = Object3D.DefaultUp.clone();
    let position = new Vector3(), rotation = new Euler(), quaternion = new Quaternion(), scale = new Vector3(1, 1, 1);
    function onRotationChange() {
      quaternion.setFromEuler(rotation, !1);
    }
    function onQuaternionChange() {
      rotation.setFromQuaternion(quaternion, void 0, !1);
    }
    rotation._onChange(onRotationChange), quaternion._onChange(onQuaternionChange), Object.defineProperties(this, {
      position: {
        configurable: !0,
        enumerable: !0,
        value: position
      },
      rotation: {
        configurable: !0,
        enumerable: !0,
        value: rotation
      },
      quaternion: {
        configurable: !0,
        enumerable: !0,
        value: quaternion
      },
      scale: {
        configurable: !0,
        enumerable: !0,
        value: scale
      },
      modelViewMatrix: {
        value: new Matrix4()
      },
      normalMatrix: {
        value: new Matrix3()
      }
    }), this.matrix = new Matrix4(), this.matrixWorld = new Matrix4(), this.matrixAutoUpdate = Object3D.DefaultMatrixAutoUpdate, this.matrixWorldNeedsUpdate = !1, this.layers = new Layers(), this.visible = !0, this.castShadow = !1, this.receiveShadow = !1, this.frustumCulled = !0, this.renderOrder = 0, this.animations = [], this.userData = {};
  }
  onBeforeRender() {
  }
  onAfterRender() {
  }
  applyMatrix4(matrix) {
    this.matrixAutoUpdate && this.updateMatrix(), this.matrix.premultiply(matrix), this.matrix.decompose(this.position, this.quaternion, this.scale);
  }
  applyQuaternion(q) {
    return this.quaternion.premultiply(q), this;
  }
  setRotationFromAxisAngle(axis, angle) {
    this.quaternion.setFromAxisAngle(axis, angle);
  }
  setRotationFromEuler(euler) {
    this.quaternion.setFromEuler(euler, !0);
  }
  setRotationFromMatrix(m) {
    this.quaternion.setFromRotationMatrix(m);
  }
  setRotationFromQuaternion(q) {
    this.quaternion.copy(q);
  }
  rotateOnAxis(axis, angle) {
    return _q1.setFromAxisAngle(axis, angle), this.quaternion.multiply(_q1), this;
  }
  rotateOnWorldAxis(axis, angle) {
    return _q1.setFromAxisAngle(axis, angle), this.quaternion.premultiply(_q1), this;
  }
  rotateX(angle) {
    return this.rotateOnAxis(_xAxis, angle);
  }
  rotateY(angle) {
    return this.rotateOnAxis(_yAxis, angle);
  }
  rotateZ(angle) {
    return this.rotateOnAxis(_zAxis, angle);
  }
  translateOnAxis(axis, distance) {
    return _v1$4.copy(axis).applyQuaternion(this.quaternion), this.position.add(_v1$4.multiplyScalar(distance)), this;
  }
  translateX(distance) {
    return this.translateOnAxis(_xAxis, distance);
  }
  translateY(distance) {
    return this.translateOnAxis(_yAxis, distance);
  }
  translateZ(distance) {
    return this.translateOnAxis(_zAxis, distance);
  }
  localToWorld(vector) {
    return vector.applyMatrix4(this.matrixWorld);
  }
  worldToLocal(vector) {
    return vector.applyMatrix4(_m1$1.copy(this.matrixWorld).invert());
  }
  lookAt(x, y, z) {
    x.isVector3 ? _target.copy(x) : _target.set(x, y, z);
    let parent = this.parent;
    this.updateWorldMatrix(!0, !1), _position$3.setFromMatrixPosition(this.matrixWorld), this.isCamera || this.isLight ? _m1$1.lookAt(_position$3, _target, this.up) : _m1$1.lookAt(_target, _position$3, this.up), this.quaternion.setFromRotationMatrix(_m1$1), parent && (_m1$1.extractRotation(parent.matrixWorld), _q1.setFromRotationMatrix(_m1$1), this.quaternion.premultiply(_q1.invert()));
  }
  add(object) {
    if (arguments.length > 1) {
      for (let i = 0; i < arguments.length; i++)
        this.add(arguments[i]);
      return this;
    }
    return object === this ? (console.error("THREE.Object3D.add: object can't be added as a child of itself.", object), this) : (object && object.isObject3D ? (object.parent !== null && object.parent.remove(object), object.parent = this, this.children.push(object), object.dispatchEvent(_addedEvent)) : console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.", object), this);
  }
  remove(object) {
    if (arguments.length > 1) {
      for (let i = 0; i < arguments.length; i++)
        this.remove(arguments[i]);
      return this;
    }
    let index = this.children.indexOf(object);
    return index !== -1 && (object.parent = null, this.children.splice(index, 1), object.dispatchEvent(_removedEvent)), this;
  }
  removeFromParent() {
    let parent = this.parent;
    return parent !== null && parent.remove(this), this;
  }
  clear() {
    for (let i = 0; i < this.children.length; i++) {
      let object = this.children[i];
      object.parent = null, object.dispatchEvent(_removedEvent);
    }
    return this.children.length = 0, this;
  }
  attach(object) {
    return this.updateWorldMatrix(!0, !1), _m1$1.copy(this.matrixWorld).invert(), object.parent !== null && (object.parent.updateWorldMatrix(!0, !1), _m1$1.multiply(object.parent.matrixWorld)), object.applyMatrix4(_m1$1), this.add(object), object.updateWorldMatrix(!1, !0), this;
  }
  getObjectById(id) {
    return this.getObjectByProperty("id", id);
  }
  getObjectByName(name) {
    return this.getObjectByProperty("name", name);
  }
  getObjectByProperty(name, value) {
    if (this[name] === value)
      return this;
    for (let i = 0, l = this.children.length; i < l; i++) {
      let object = this.children[i].getObjectByProperty(name, value);
      if (object !== void 0)
        return object;
    }
  }
  getWorldPosition(target) {
    return target === void 0 && (console.warn("THREE.Object3D: .getWorldPosition() target is now required"), target = new Vector3()), this.updateWorldMatrix(!0, !1), target.setFromMatrixPosition(this.matrixWorld);
  }
  getWorldQuaternion(target) {
    return target === void 0 && (console.warn("THREE.Object3D: .getWorldQuaternion() target is now required"), target = new Quaternion()), this.updateWorldMatrix(!0, !1), this.matrixWorld.decompose(_position$3, target, _scale$2), target;
  }
  getWorldScale(target) {
    return target === void 0 && (console.warn("THREE.Object3D: .getWorldScale() target is now required"), target = new Vector3()), this.updateWorldMatrix(!0, !1), this.matrixWorld.decompose(_position$3, _quaternion$2, target), target;
  }
  getWorldDirection(target) {
    target === void 0 && (console.warn("THREE.Object3D: .getWorldDirection() target is now required"), target = new Vector3()), this.updateWorldMatrix(!0, !1);
    let e = this.matrixWorld.elements;
    return target.set(e[8], e[9], e[10]).normalize();
  }
  raycast() {
  }
  traverse(callback) {
    callback(this);
    let children = this.children;
    for (let i = 0, l = children.length; i < l; i++)
      children[i].traverse(callback);
  }
  traverseVisible(callback) {
    if (this.visible === !1)
      return;
    callback(this);
    let children = this.children;
    for (let i = 0, l = children.length; i < l; i++)
      children[i].traverseVisible(callback);
  }
  traverseAncestors(callback) {
    let parent = this.parent;
    parent !== null && (callback(parent), parent.traverseAncestors(callback));
  }
  updateMatrix() {
    this.matrix.compose(this.position, this.quaternion, this.scale), this.matrixWorldNeedsUpdate = !0;
  }
  updateMatrixWorld(force) {
    this.matrixAutoUpdate && this.updateMatrix(), (this.matrixWorldNeedsUpdate || force) && (this.parent === null ? this.matrixWorld.copy(this.matrix) : this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix), this.matrixWorldNeedsUpdate = !1, force = !0);
    let children = this.children;
    for (let i = 0, l = children.length; i < l; i++)
      children[i].updateMatrixWorld(force);
  }
  updateWorldMatrix(updateParents, updateChildren) {
    let parent = this.parent;
    if (updateParents === !0 && parent !== null && parent.updateWorldMatrix(!0, !1), this.matrixAutoUpdate && this.updateMatrix(), this.parent === null ? this.matrixWorld.copy(this.matrix) : this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix), updateChildren === !0) {
      let children = this.children;
      for (let i = 0, l = children.length; i < l; i++)
        children[i].updateWorldMatrix(!1, !0);
    }
  }
  toJSON(meta) {
    let isRootObject = meta === void 0 || typeof meta == "string", output = {};
    isRootObject && (meta = {
      geometries: {},
      materials: {},
      textures: {},
      images: {},
      shapes: {},
      skeletons: {},
      animations: {}
    }, output.metadata = {
      version: 4.5,
      type: "Object",
      generator: "Object3D.toJSON"
    });
    let object = {};
    object.uuid = this.uuid, object.type = this.type, this.name !== "" && (object.name = this.name), this.castShadow === !0 && (object.castShadow = !0), this.receiveShadow === !0 && (object.receiveShadow = !0), this.visible === !1 && (object.visible = !1), this.frustumCulled === !1 && (object.frustumCulled = !1), this.renderOrder !== 0 && (object.renderOrder = this.renderOrder), JSON.stringify(this.userData) !== "{}" && (object.userData = this.userData), object.layers = this.layers.mask, object.matrix = this.matrix.toArray(), this.matrixAutoUpdate === !1 && (object.matrixAutoUpdate = !1), this.isInstancedMesh && (object.type = "InstancedMesh", object.count = this.count, object.instanceMatrix = this.instanceMatrix.toJSON(), this.instanceColor !== null && (object.instanceColor = this.instanceColor.toJSON()));
    function serialize(library, element) {
      return library[element.uuid] === void 0 && (library[element.uuid] = element.toJSON(meta)), element.uuid;
    }
    if (this.isMesh || this.isLine || this.isPoints) {
      object.geometry = serialize(meta.geometries, this.geometry);
      let parameters = this.geometry.parameters;
      if (parameters !== void 0 && parameters.shapes !== void 0) {
        let shapes = parameters.shapes;
        if (Array.isArray(shapes))
          for (let i = 0, l = shapes.length; i < l; i++) {
            let shape = shapes[i];
            serialize(meta.shapes, shape);
          }
        else
          serialize(meta.shapes, shapes);
      }
    }
    if (this.isSkinnedMesh && (object.bindMode = this.bindMode, object.bindMatrix = this.bindMatrix.toArray(), this.skeleton !== void 0 && (serialize(meta.skeletons, this.skeleton), object.skeleton = this.skeleton.uuid)), this.material !== void 0)
      if (Array.isArray(this.material)) {
        let uuids = [];
        for (let i = 0, l = this.material.length; i < l; i++)
          uuids.push(serialize(meta.materials, this.material[i]));
        object.material = uuids;
      } else
        object.material = serialize(meta.materials, this.material);
    if (this.children.length > 0) {
      object.children = [];
      for (let i = 0; i < this.children.length; i++)
        object.children.push(this.children[i].toJSON(meta).object);
    }
    if (this.animations.length > 0) {
      object.animations = [];
      for (let i = 0; i < this.animations.length; i++) {
        let animation = this.animations[i];
        object.animations.push(serialize(meta.animations, animation));
      }
    }
    if (isRootObject) {
      let geometries = extractFromCache(meta.geometries), materials = extractFromCache(meta.materials), textures = extractFromCache(meta.textures), images = extractFromCache(meta.images), shapes = extractFromCache(meta.shapes), skeletons = extractFromCache(meta.skeletons), animations = extractFromCache(meta.animations);
      geometries.length > 0 && (output.geometries = geometries), materials.length > 0 && (output.materials = materials), textures.length > 0 && (output.textures = textures), images.length > 0 && (output.images = images), shapes.length > 0 && (output.shapes = shapes), skeletons.length > 0 && (output.skeletons = skeletons), animations.length > 0 && (output.animations = animations);
    }
    return output.object = object, output;
    function extractFromCache(cache) {
      let values = [];
      for (let key in cache) {
        let data = cache[key];
        delete data.metadata, values.push(data);
      }
      return values;
    }
  }
  clone(recursive) {
    return new this.constructor().copy(this, recursive);
  }
  copy(source, recursive = !0) {
    if (this.name = source.name, this.up.copy(source.up), this.position.copy(source.position), this.rotation.order = source.rotation.order, this.quaternion.copy(source.quaternion), this.scale.copy(source.scale), this.matrix.copy(source.matrix), this.matrixWorld.copy(source.matrixWorld), this.matrixAutoUpdate = source.matrixAutoUpdate, this.matrixWorldNeedsUpdate = source.matrixWorldNeedsUpdate, this.layers.mask = source.layers.mask, this.visible = source.visible, this.castShadow = source.castShadow, this.receiveShadow = source.receiveShadow, this.frustumCulled = source.frustumCulled, this.renderOrder = source.renderOrder, this.userData = JSON.parse(JSON.stringify(source.userData)), recursive === !0)
      for (let i = 0; i < source.children.length; i++) {
        let child = source.children[i];
        this.add(child.clone());
      }
    return this;
  }
};
Object3D.DefaultUp = new Vector3(0, 1, 0);
Object3D.DefaultMatrixAutoUpdate = !0;
Object3D.prototype.isObject3D = !0;
var _vector1 = /* @__PURE__ */ new Vector3(), _vector2$1 = /* @__PURE__ */ new Vector3(), _normalMatrix = /* @__PURE__ */ new Matrix3(), Plane = class {
  constructor(normal = new Vector3(1, 0, 0), constant = 0) {
    this.normal = normal, this.constant = constant;
  }
  set(normal, constant) {
    return this.normal.copy(normal), this.constant = constant, this;
  }
  setComponents(x, y, z, w) {
    return this.normal.set(x, y, z), this.constant = w, this;
  }
  setFromNormalAndCoplanarPoint(normal, point) {
    return this.normal.copy(normal), this.constant = -point.dot(this.normal), this;
  }
  setFromCoplanarPoints(a, b, c) {
    let normal = _vector1.subVectors(c, b).cross(_vector2$1.subVectors(a, b)).normalize();
    return this.setFromNormalAndCoplanarPoint(normal, a), this;
  }
  copy(plane) {
    return this.normal.copy(plane.normal), this.constant = plane.constant, this;
  }
  normalize() {
    let inverseNormalLength = 1 / this.normal.length();
    return this.normal.multiplyScalar(inverseNormalLength), this.constant *= inverseNormalLength, this;
  }
  negate() {
    return this.constant *= -1, this.normal.negate(), this;
  }
  distanceToPoint(point) {
    return this.normal.dot(point) + this.constant;
  }
  distanceToSphere(sphere) {
    return this.distanceToPoint(sphere.center) - sphere.radius;
  }
  projectPoint(point, target) {
    return target === void 0 && (console.warn("THREE.Plane: .projectPoint() target is now required"), target = new Vector3()), target.copy(this.normal).multiplyScalar(-this.distanceToPoint(point)).add(point);
  }
  intersectLine(line, target) {
    target === void 0 && (console.warn("THREE.Plane: .intersectLine() target is now required"), target = new Vector3());
    let direction = line.delta(_vector1), denominator = this.normal.dot(direction);
    if (denominator === 0)
      return this.distanceToPoint(line.start) === 0 ? target.copy(line.start) : null;
    let t = -(line.start.dot(this.normal) + this.constant) / denominator;
    return t < 0 || t > 1 ? null : target.copy(direction).multiplyScalar(t).add(line.start);
  }
  intersectsLine(line) {
    let startSign = this.distanceToPoint(line.start), endSign = this.distanceToPoint(line.end);
    return startSign < 0 && endSign > 0 || endSign < 0 && startSign > 0;
  }
  intersectsBox(box) {
    return box.intersectsPlane(this);
  }
  intersectsSphere(sphere) {
    return sphere.intersectsPlane(this);
  }
  coplanarPoint(target) {
    return target === void 0 && (console.warn("THREE.Plane: .coplanarPoint() target is now required"), target = new Vector3()), target.copy(this.normal).multiplyScalar(-this.constant);
  }
  applyMatrix4(matrix, optionalNormalMatrix) {
    let normalMatrix = optionalNormalMatrix || _normalMatrix.getNormalMatrix(matrix), referencePoint = this.coplanarPoint(_vector1).applyMatrix4(matrix), normal = this.normal.applyMatrix3(normalMatrix).normalize();
    return this.constant = -referencePoint.dot(normal), this;
  }
  translate(offset) {
    return this.constant -= offset.dot(this.normal), this;
  }
  equals(plane) {
    return plane.normal.equals(this.normal) && plane.constant === this.constant;
  }
  clone() {
    return new this.constructor().copy(this);
  }
};
Plane.prototype.isPlane = !0;
var _v0$1 = /* @__PURE__ */ new Vector3(), _v1$3 = /* @__PURE__ */ new Vector3(), _v2$2 = /* @__PURE__ */ new Vector3(), _v3$1 = /* @__PURE__ */ new Vector3(), _vab = /* @__PURE__ */ new Vector3(), _vac = /* @__PURE__ */ new Vector3(), _vbc = /* @__PURE__ */ new Vector3(), _vap = /* @__PURE__ */ new Vector3(), _vbp = /* @__PURE__ */ new Vector3(), _vcp = /* @__PURE__ */ new Vector3(), Triangle = class {
  constructor(a = new Vector3(), b = new Vector3(), c = new Vector3()) {
    this.a = a, this.b = b, this.c = c;
  }
  static getNormal(a, b, c, target) {
    target === void 0 && (console.warn("THREE.Triangle: .getNormal() target is now required"), target = new Vector3()), target.subVectors(c, b), _v0$1.subVectors(a, b), target.cross(_v0$1);
    let targetLengthSq = target.lengthSq();
    return targetLengthSq > 0 ? target.multiplyScalar(1 / Math.sqrt(targetLengthSq)) : target.set(0, 0, 0);
  }
  static getBarycoord(point, a, b, c, target) {
    _v0$1.subVectors(c, a), _v1$3.subVectors(b, a), _v2$2.subVectors(point, a);
    let dot00 = _v0$1.dot(_v0$1), dot01 = _v0$1.dot(_v1$3), dot02 = _v0$1.dot(_v2$2), dot11 = _v1$3.dot(_v1$3), dot12 = _v1$3.dot(_v2$2), denom = dot00 * dot11 - dot01 * dot01;
    if (target === void 0 && (console.warn("THREE.Triangle: .getBarycoord() target is now required"), target = new Vector3()), denom === 0)
      return target.set(-2, -1, -1);
    let invDenom = 1 / denom, u = (dot11 * dot02 - dot01 * dot12) * invDenom, v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    return target.set(1 - u - v, v, u);
  }
  static containsPoint(point, a, b, c) {
    return this.getBarycoord(point, a, b, c, _v3$1), _v3$1.x >= 0 && _v3$1.y >= 0 && _v3$1.x + _v3$1.y <= 1;
  }
  static getUV(point, p1, p2, p3, uv1, uv2, uv3, target) {
    return this.getBarycoord(point, p1, p2, p3, _v3$1), target.set(0, 0), target.addScaledVector(uv1, _v3$1.x), target.addScaledVector(uv2, _v3$1.y), target.addScaledVector(uv3, _v3$1.z), target;
  }
  static isFrontFacing(a, b, c, direction) {
    return _v0$1.subVectors(c, b), _v1$3.subVectors(a, b), _v0$1.cross(_v1$3).dot(direction) < 0;
  }
  set(a, b, c) {
    return this.a.copy(a), this.b.copy(b), this.c.copy(c), this;
  }
  setFromPointsAndIndices(points, i0, i1, i2) {
    return this.a.copy(points[i0]), this.b.copy(points[i1]), this.c.copy(points[i2]), this;
  }
  clone() {
    return new this.constructor().copy(this);
  }
  copy(triangle) {
    return this.a.copy(triangle.a), this.b.copy(triangle.b), this.c.copy(triangle.c), this;
  }
  getArea() {
    return _v0$1.subVectors(this.c, this.b), _v1$3.subVectors(this.a, this.b), _v0$1.cross(_v1$3).length() * 0.5;
  }
  getMidpoint(target) {
    return target === void 0 && (console.warn("THREE.Triangle: .getMidpoint() target is now required"), target = new Vector3()), target.addVectors(this.a, this.b).add(this.c).multiplyScalar(1 / 3);
  }
  getNormal(target) {
    return Triangle.getNormal(this.a, this.b, this.c, target);
  }
  getPlane(target) {
    return target === void 0 && (console.warn("THREE.Triangle: .getPlane() target is now required"), target = new Plane()), target.setFromCoplanarPoints(this.a, this.b, this.c);
  }
  getBarycoord(point, target) {
    return Triangle.getBarycoord(point, this.a, this.b, this.c, target);
  }
  getUV(point, uv1, uv2, uv3, target) {
    return Triangle.getUV(point, this.a, this.b, this.c, uv1, uv2, uv3, target);
  }
  containsPoint(point) {
    return Triangle.containsPoint(point, this.a, this.b, this.c);
  }
  isFrontFacing(direction) {
    return Triangle.isFrontFacing(this.a, this.b, this.c, direction);
  }
  intersectsBox(box) {
    return box.intersectsTriangle(this);
  }
  closestPointToPoint(p, target) {
    target === void 0 && (console.warn("THREE.Triangle: .closestPointToPoint() target is now required"), target = new Vector3());
    let a = this.a, b = this.b, c = this.c, v, w;
    _vab.subVectors(b, a), _vac.subVectors(c, a), _vap.subVectors(p, a);
    let d1 = _vab.dot(_vap), d2 = _vac.dot(_vap);
    if (d1 <= 0 && d2 <= 0)
      return target.copy(a);
    _vbp.subVectors(p, b);
    let d3 = _vab.dot(_vbp), d4 = _vac.dot(_vbp);
    if (d3 >= 0 && d4 <= d3)
      return target.copy(b);
    let vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0)
      return v = d1 / (d1 - d3), target.copy(a).addScaledVector(_vab, v);
    _vcp.subVectors(p, c);
    let d5 = _vab.dot(_vcp), d6 = _vac.dot(_vcp);
    if (d6 >= 0 && d5 <= d6)
      return target.copy(c);
    let vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0)
      return w = d2 / (d2 - d6), target.copy(a).addScaledVector(_vac, w);
    let va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
      return _vbc.subVectors(c, b), w = (d4 - d3) / (d4 - d3 + (d5 - d6)), target.copy(b).addScaledVector(_vbc, w);
    let denom = 1 / (va + vb + vc);
    return v = vb * denom, w = vc * denom, target.copy(a).addScaledVector(_vab, v).addScaledVector(_vac, w);
  }
  equals(triangle) {
    return triangle.a.equals(this.a) && triangle.b.equals(this.b) && triangle.c.equals(this.c);
  }
}, materialId = 0, Material = class extends EventDispatcher {
  constructor() {
    super();
    Object.defineProperty(this, "id", { value: materialId++ }), this.uuid = generateUUID(), this.name = "", this.type = "Material", this.fog = !0, this.blending = NormalBlending, this.side = FrontSide, this.vertexColors = !1, this.opacity = 1, this.transparent = !1, this.blendSrc = SrcAlphaFactor, this.blendDst = OneMinusSrcAlphaFactor, this.blendEquation = AddEquation, this.blendSrcAlpha = null, this.blendDstAlpha = null, this.blendEquationAlpha = null, this.depthFunc = LessEqualDepth, this.depthTest = !0, this.depthWrite = !0, this.stencilWriteMask = 255, this.stencilFunc = AlwaysStencilFunc, this.stencilRef = 0, this.stencilFuncMask = 255, this.stencilFail = KeepStencilOp, this.stencilZFail = KeepStencilOp, this.stencilZPass = KeepStencilOp, this.stencilWrite = !1, this.clippingPlanes = null, this.clipIntersection = !1, this.clipShadows = !1, this.shadowSide = null, this.colorWrite = !0, this.precision = null, this.polygonOffset = !1, this.polygonOffsetFactor = 0, this.polygonOffsetUnits = 0, this.dithering = !1, this.alphaTest = 0, this.alphaToCoverage = !1, this.premultipliedAlpha = !1, this.visible = !0, this.toneMapped = !0, this.userData = {}, this.version = 0;
  }
  onBuild() {
  }
  onBeforeCompile() {
  }
  customProgramCacheKey() {
    return this.onBeforeCompile.toString();
  }
  setValues(values) {
    if (values !== void 0)
      for (let key in values) {
        let newValue = values[key];
        if (newValue === void 0) {
          console.warn("THREE.Material: '" + key + "' parameter is undefined.");
          continue;
        }
        if (key === "shading") {
          console.warn("THREE." + this.type + ": .shading has been removed. Use the boolean .flatShading instead."), this.flatShading = newValue === FlatShading;
          continue;
        }
        let currentValue = this[key];
        if (currentValue === void 0) {
          console.warn("THREE." + this.type + ": '" + key + "' is not a property of this material.");
          continue;
        }
        currentValue && currentValue.isColor ? currentValue.set(newValue) : currentValue && currentValue.isVector3 && newValue && newValue.isVector3 ? currentValue.copy(newValue) : this[key] = newValue;
      }
  }
  toJSON(meta) {
    let isRoot = meta === void 0 || typeof meta == "string";
    isRoot && (meta = {
      textures: {},
      images: {}
    });
    let data = {
      metadata: {
        version: 4.5,
        type: "Material",
        generator: "Material.toJSON"
      }
    };
    data.uuid = this.uuid, data.type = this.type, this.name !== "" && (data.name = this.name), this.color && this.color.isColor && (data.color = this.color.getHex()), this.roughness !== void 0 && (data.roughness = this.roughness), this.metalness !== void 0 && (data.metalness = this.metalness), this.sheen && this.sheen.isColor && (data.sheen = this.sheen.getHex()), this.emissive && this.emissive.isColor && (data.emissive = this.emissive.getHex()), this.emissiveIntensity && this.emissiveIntensity !== 1 && (data.emissiveIntensity = this.emissiveIntensity), this.specular && this.specular.isColor && (data.specular = this.specular.getHex()), this.shininess !== void 0 && (data.shininess = this.shininess), this.clearcoat !== void 0 && (data.clearcoat = this.clearcoat), this.clearcoatRoughness !== void 0 && (data.clearcoatRoughness = this.clearcoatRoughness), this.clearcoatMap && this.clearcoatMap.isTexture && (data.clearcoatMap = this.clearcoatMap.toJSON(meta).uuid), this.clearcoatRoughnessMap && this.clearcoatRoughnessMap.isTexture && (data.clearcoatRoughnessMap = this.clearcoatRoughnessMap.toJSON(meta).uuid), this.clearcoatNormalMap && this.clearcoatNormalMap.isTexture && (data.clearcoatNormalMap = this.clearcoatNormalMap.toJSON(meta).uuid, data.clearcoatNormalScale = this.clearcoatNormalScale.toArray()), this.map && this.map.isTexture && (data.map = this.map.toJSON(meta).uuid), this.matcap && this.matcap.isTexture && (data.matcap = this.matcap.toJSON(meta).uuid), this.alphaMap && this.alphaMap.isTexture && (data.alphaMap = this.alphaMap.toJSON(meta).uuid), this.lightMap && this.lightMap.isTexture && (data.lightMap = this.lightMap.toJSON(meta).uuid, data.lightMapIntensity = this.lightMapIntensity), this.aoMap && this.aoMap.isTexture && (data.aoMap = this.aoMap.toJSON(meta).uuid, data.aoMapIntensity = this.aoMapIntensity), this.bumpMap && this.bumpMap.isTexture && (data.bumpMap = this.bumpMap.toJSON(meta).uuid, data.bumpScale = this.bumpScale), this.normalMap && this.normalMap.isTexture && (data.normalMap = this.normalMap.toJSON(meta).uuid, data.normalMapType = this.normalMapType, data.normalScale = this.normalScale.toArray()), this.displacementMap && this.displacementMap.isTexture && (data.displacementMap = this.displacementMap.toJSON(meta).uuid, data.displacementScale = this.displacementScale, data.displacementBias = this.displacementBias), this.roughnessMap && this.roughnessMap.isTexture && (data.roughnessMap = this.roughnessMap.toJSON(meta).uuid), this.metalnessMap && this.metalnessMap.isTexture && (data.metalnessMap = this.metalnessMap.toJSON(meta).uuid), this.emissiveMap && this.emissiveMap.isTexture && (data.emissiveMap = this.emissiveMap.toJSON(meta).uuid), this.specularMap && this.specularMap.isTexture && (data.specularMap = this.specularMap.toJSON(meta).uuid), this.envMap && this.envMap.isTexture && (data.envMap = this.envMap.toJSON(meta).uuid, this.combine !== void 0 && (data.combine = this.combine)), this.envMapIntensity !== void 0 && (data.envMapIntensity = this.envMapIntensity), this.reflectivity !== void 0 && (data.reflectivity = this.reflectivity), this.refractionRatio !== void 0 && (data.refractionRatio = this.refractionRatio), this.gradientMap && this.gradientMap.isTexture && (data.gradientMap = this.gradientMap.toJSON(meta).uuid), this.transmission !== void 0 && (data.transmission = this.transmission), this.transmissionMap && this.transmissionMap.isTexture && (data.transmissionMap = this.transmissionMap.toJSON(meta).uuid), this.thickness !== void 0 && (data.thickness = this.thickness), this.thicknessMap && this.thicknessMap.isTexture && (data.thicknessMap = this.thicknessMap.toJSON(meta).uuid), this.attenuationDistance !== void 0 && (data.attenuationDistance = this.attenuationDistance), this.attenuationColor !== void 0 && (data.attenuationColor = this.attenuationColor.getHex()), this.size !== void 0 && (data.size = this.size), this.shadowSide !== null && (data.shadowSide = this.shadowSide), this.sizeAttenuation !== void 0 && (data.sizeAttenuation = this.sizeAttenuation), this.blending !== NormalBlending && (data.blending = this.blending), this.side !== FrontSide && (data.side = this.side), this.vertexColors && (data.vertexColors = !0), this.opacity < 1 && (data.opacity = this.opacity), this.transparent === !0 && (data.transparent = this.transparent), data.depthFunc = this.depthFunc, data.depthTest = this.depthTest, data.depthWrite = this.depthWrite, data.colorWrite = this.colorWrite, data.stencilWrite = this.stencilWrite, data.stencilWriteMask = this.stencilWriteMask, data.stencilFunc = this.stencilFunc, data.stencilRef = this.stencilRef, data.stencilFuncMask = this.stencilFuncMask, data.stencilFail = this.stencilFail, data.stencilZFail = this.stencilZFail, data.stencilZPass = this.stencilZPass, this.rotation && this.rotation !== 0 && (data.rotation = this.rotation), this.polygonOffset === !0 && (data.polygonOffset = !0), this.polygonOffsetFactor !== 0 && (data.polygonOffsetFactor = this.polygonOffsetFactor), this.polygonOffsetUnits !== 0 && (data.polygonOffsetUnits = this.polygonOffsetUnits), this.linewidth && this.linewidth !== 1 && (data.linewidth = this.linewidth), this.dashSize !== void 0 && (data.dashSize = this.dashSize), this.gapSize !== void 0 && (data.gapSize = this.gapSize), this.scale !== void 0 && (data.scale = this.scale), this.dithering === !0 && (data.dithering = !0), this.alphaTest > 0 && (data.alphaTest = this.alphaTest), this.alphaToCoverage === !0 && (data.alphaToCoverage = this.alphaToCoverage), this.premultipliedAlpha === !0 && (data.premultipliedAlpha = this.premultipliedAlpha), this.wireframe === !0 && (data.wireframe = this.wireframe), this.wireframeLinewidth > 1 && (data.wireframeLinewidth = this.wireframeLinewidth), this.wireframeLinecap !== "round" && (data.wireframeLinecap = this.wireframeLinecap), this.wireframeLinejoin !== "round" && (data.wireframeLinejoin = this.wireframeLinejoin), this.morphTargets === !0 && (data.morphTargets = !0), this.morphNormals === !0 && (data.morphNormals = !0), this.flatShading === !0 && (data.flatShading = this.flatShading), this.visible === !1 && (data.visible = !1), this.toneMapped === !1 && (data.toneMapped = !1), JSON.stringify(this.userData) !== "{}" && (data.userData = this.userData);
    function extractFromCache(cache) {
      let values = [];
      for (let key in cache) {
        let data2 = cache[key];
        delete data2.metadata, values.push(data2);
      }
      return values;
    }
    if (isRoot) {
      let textures = extractFromCache(meta.textures), images = extractFromCache(meta.images);
      textures.length > 0 && (data.textures = textures), images.length > 0 && (data.images = images);
    }
    return data;
  }
  clone() {
    return new this.constructor().copy(this);
  }
  copy(source) {
    this.name = source.name, this.fog = source.fog, this.blending = source.blending, this.side = source.side, this.vertexColors = source.vertexColors, this.opacity = source.opacity, this.transparent = source.transparent, this.blendSrc = source.blendSrc, this.blendDst = source.blendDst, this.blendEquation = source.blendEquation, this.blendSrcAlpha = source.blendSrcAlpha, this.blendDstAlpha = source.blendDstAlpha, this.blendEquationAlpha = source.blendEquationAlpha, this.depthFunc = source.depthFunc, this.depthTest = source.depthTest, this.depthWrite = source.depthWrite, this.stencilWriteMask = source.stencilWriteMask, this.stencilFunc = source.stencilFunc, this.stencilRef = source.stencilRef, this.stencilFuncMask = source.stencilFuncMask, this.stencilFail = source.stencilFail, this.stencilZFail = source.stencilZFail, this.stencilZPass = source.stencilZPass, this.stencilWrite = source.stencilWrite;
    let srcPlanes = source.clippingPlanes, dstPlanes = null;
    if (srcPlanes !== null) {
      let n = srcPlanes.length;
      dstPlanes = new Array(n);
      for (let i = 0; i !== n; ++i)
        dstPlanes[i] = srcPlanes[i].clone();
    }
    return this.clippingPlanes = dstPlanes, this.clipIntersection = source.clipIntersection, this.clipShadows = source.clipShadows, this.shadowSide = source.shadowSide, this.colorWrite = source.colorWrite, this.precision = source.precision, this.polygonOffset = source.polygonOffset, this.polygonOffsetFactor = source.polygonOffsetFactor, this.polygonOffsetUnits = source.polygonOffsetUnits, this.dithering = source.dithering, this.alphaTest = source.alphaTest, this.alphaToCoverage = source.alphaToCoverage, this.premultipliedAlpha = source.premultipliedAlpha, this.visible = source.visible, this.toneMapped = source.toneMapped, this.userData = JSON.parse(JSON.stringify(source.userData)), this;
  }
  dispose() {
    this.dispatchEvent({ type: "dispose" });
  }
  set needsUpdate(value) {
    value === !0 && this.version++;
  }
};
Material.prototype.isMaterial = !0;
var _colorKeywords = {
  aliceblue: 15792383,
  antiquewhite: 16444375,
  aqua: 65535,
  aquamarine: 8388564,
  azure: 15794175,
  beige: 16119260,
  bisque: 16770244,
  black: 0,
  blanchedalmond: 16772045,
  blue: 255,
  blueviolet: 9055202,
  brown: 10824234,
  burlywood: 14596231,
  cadetblue: 6266528,
  chartreuse: 8388352,
  chocolate: 13789470,
  coral: 16744272,
  cornflowerblue: 6591981,
  cornsilk: 16775388,
  crimson: 14423100,
  cyan: 65535,
  darkblue: 139,
  darkcyan: 35723,
  darkgoldenrod: 12092939,
  darkgray: 11119017,
  darkgreen: 25600,
  darkgrey: 11119017,
  darkkhaki: 12433259,
  darkmagenta: 9109643,
  darkolivegreen: 5597999,
  darkorange: 16747520,
  darkorchid: 10040012,
  darkred: 9109504,
  darksalmon: 15308410,
  darkseagreen: 9419919,
  darkslateblue: 4734347,
  darkslategray: 3100495,
  darkslategrey: 3100495,
  darkturquoise: 52945,
  darkviolet: 9699539,
  deeppink: 16716947,
  deepskyblue: 49151,
  dimgray: 6908265,
  dimgrey: 6908265,
  dodgerblue: 2003199,
  firebrick: 11674146,
  floralwhite: 16775920,
  forestgreen: 2263842,
  fuchsia: 16711935,
  gainsboro: 14474460,
  ghostwhite: 16316671,
  gold: 16766720,
  goldenrod: 14329120,
  gray: 8421504,
  green: 32768,
  greenyellow: 11403055,
  grey: 8421504,
  honeydew: 15794160,
  hotpink: 16738740,
  indianred: 13458524,
  indigo: 4915330,
  ivory: 16777200,
  khaki: 15787660,
  lavender: 15132410,
  lavenderblush: 16773365,
  lawngreen: 8190976,
  lemonchiffon: 16775885,
  lightblue: 11393254,
  lightcoral: 15761536,
  lightcyan: 14745599,
  lightgoldenrodyellow: 16448210,
  lightgray: 13882323,
  lightgreen: 9498256,
  lightgrey: 13882323,
  lightpink: 16758465,
  lightsalmon: 16752762,
  lightseagreen: 2142890,
  lightskyblue: 8900346,
  lightslategray: 7833753,
  lightslategrey: 7833753,
  lightsteelblue: 11584734,
  lightyellow: 16777184,
  lime: 65280,
  limegreen: 3329330,
  linen: 16445670,
  magenta: 16711935,
  maroon: 8388608,
  mediumaquamarine: 6737322,
  mediumblue: 205,
  mediumorchid: 12211667,
  mediumpurple: 9662683,
  mediumseagreen: 3978097,
  mediumslateblue: 8087790,
  mediumspringgreen: 64154,
  mediumturquoise: 4772300,
  mediumvioletred: 13047173,
  midnightblue: 1644912,
  mintcream: 16121850,
  mistyrose: 16770273,
  moccasin: 16770229,
  navajowhite: 16768685,
  navy: 128,
  oldlace: 16643558,
  olive: 8421376,
  olivedrab: 7048739,
  orange: 16753920,
  orangered: 16729344,
  orchid: 14315734,
  palegoldenrod: 15657130,
  palegreen: 10025880,
  paleturquoise: 11529966,
  palevioletred: 14381203,
  papayawhip: 16773077,
  peachpuff: 16767673,
  peru: 13468991,
  pink: 16761035,
  plum: 14524637,
  powderblue: 11591910,
  purple: 8388736,
  rebeccapurple: 6697881,
  red: 16711680,
  rosybrown: 12357519,
  royalblue: 4286945,
  saddlebrown: 9127187,
  salmon: 16416882,
  sandybrown: 16032864,
  seagreen: 3050327,
  seashell: 16774638,
  sienna: 10506797,
  silver: 12632256,
  skyblue: 8900331,
  slateblue: 6970061,
  slategray: 7372944,
  slategrey: 7372944,
  snow: 16775930,
  springgreen: 65407,
  steelblue: 4620980,
  tan: 13808780,
  teal: 32896,
  thistle: 14204888,
  tomato: 16737095,
  turquoise: 4251856,
  violet: 15631086,
  wheat: 16113331,
  white: 16777215,
  whitesmoke: 16119285,
  yellow: 16776960,
  yellowgreen: 10145074
}, _hslA = { h: 0, s: 0, l: 0 }, _hslB = { h: 0, s: 0, l: 0 };
function hue2rgb(p, q, t) {
  return t < 0 && (t += 1), t > 1 && (t -= 1), t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * 6 * (2 / 3 - t) : p;
}
function SRGBToLinear(c) {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}
function LinearToSRGB(c) {
  return c < 31308e-7 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055;
}
var Color = class {
  constructor(r, g, b) {
    return g === void 0 && b === void 0 ? this.set(r) : this.setRGB(r, g, b);
  }
  set(value) {
    return value && value.isColor ? this.copy(value) : typeof value == "number" ? this.setHex(value) : typeof value == "string" && this.setStyle(value), this;
  }
  setScalar(scalar) {
    return this.r = scalar, this.g = scalar, this.b = scalar, this;
  }
  setHex(hex) {
    return hex = Math.floor(hex), this.r = (hex >> 16 & 255) / 255, this.g = (hex >> 8 & 255) / 255, this.b = (hex & 255) / 255, this;
  }
  setRGB(r, g, b) {
    return this.r = r, this.g = g, this.b = b, this;
  }
  setHSL(h, s, l) {
    if (h = euclideanModulo(h, 1), s = clamp(s, 0, 1), l = clamp(l, 0, 1), s === 0)
      this.r = this.g = this.b = l;
    else {
      let p = l <= 0.5 ? l * (1 + s) : l + s - l * s, q = 2 * l - p;
      this.r = hue2rgb(q, p, h + 1 / 3), this.g = hue2rgb(q, p, h), this.b = hue2rgb(q, p, h - 1 / 3);
    }
    return this;
  }
  setStyle(style) {
    function handleAlpha(string) {
      string !== void 0 && parseFloat(string) < 1 && console.warn("THREE.Color: Alpha component of " + style + " will be ignored.");
    }
    let m;
    if (m = /^((?:rgb|hsl)a?)\(([^\)]*)\)/.exec(style)) {
      let color, name = m[1], components = m[2];
      switch (name) {
        case "rgb":
        case "rgba":
          if (color = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(components))
            return this.r = Math.min(255, parseInt(color[1], 10)) / 255, this.g = Math.min(255, parseInt(color[2], 10)) / 255, this.b = Math.min(255, parseInt(color[3], 10)) / 255, handleAlpha(color[4]), this;
          if (color = /^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(components))
            return this.r = Math.min(100, parseInt(color[1], 10)) / 100, this.g = Math.min(100, parseInt(color[2], 10)) / 100, this.b = Math.min(100, parseInt(color[3], 10)) / 100, handleAlpha(color[4]), this;
          break;
        case "hsl":
        case "hsla":
          if (color = /^\s*(\d*\.?\d+)\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(components)) {
            let h = parseFloat(color[1]) / 360, s = parseInt(color[2], 10) / 100, l = parseInt(color[3], 10) / 100;
            return handleAlpha(color[4]), this.setHSL(h, s, l);
          }
          break;
      }
    } else if (m = /^\#([A-Fa-f\d]+)$/.exec(style)) {
      let hex = m[1], size = hex.length;
      if (size === 3)
        return this.r = parseInt(hex.charAt(0) + hex.charAt(0), 16) / 255, this.g = parseInt(hex.charAt(1) + hex.charAt(1), 16) / 255, this.b = parseInt(hex.charAt(2) + hex.charAt(2), 16) / 255, this;
      if (size === 6)
        return this.r = parseInt(hex.charAt(0) + hex.charAt(1), 16) / 255, this.g = parseInt(hex.charAt(2) + hex.charAt(3), 16) / 255, this.b = parseInt(hex.charAt(4) + hex.charAt(5), 16) / 255, this;
    }
    return style && style.length > 0 ? this.setColorName(style) : this;
  }
  setColorName(style) {
    let hex = _colorKeywords[style.toLowerCase()];
    return hex !== void 0 ? this.setHex(hex) : console.warn("THREE.Color: Unknown color " + style), this;
  }
  clone() {
    return new this.constructor(this.r, this.g, this.b);
  }
  copy(color) {
    return this.r = color.r, this.g = color.g, this.b = color.b, this;
  }
  copyGammaToLinear(color, gammaFactor = 2) {
    return this.r = Math.pow(color.r, gammaFactor), this.g = Math.pow(color.g, gammaFactor), this.b = Math.pow(color.b, gammaFactor), this;
  }
  copyLinearToGamma(color, gammaFactor = 2) {
    let safeInverse = gammaFactor > 0 ? 1 / gammaFactor : 1;
    return this.r = Math.pow(color.r, safeInverse), this.g = Math.pow(color.g, safeInverse), this.b = Math.pow(color.b, safeInverse), this;
  }
  convertGammaToLinear(gammaFactor) {
    return this.copyGammaToLinear(this, gammaFactor), this;
  }
  convertLinearToGamma(gammaFactor) {
    return this.copyLinearToGamma(this, gammaFactor), this;
  }
  copySRGBToLinear(color) {
    return this.r = SRGBToLinear(color.r), this.g = SRGBToLinear(color.g), this.b = SRGBToLinear(color.b), this;
  }
  copyLinearToSRGB(color) {
    return this.r = LinearToSRGB(color.r), this.g = LinearToSRGB(color.g), this.b = LinearToSRGB(color.b), this;
  }
  convertSRGBToLinear() {
    return this.copySRGBToLinear(this), this;
  }
  convertLinearToSRGB() {
    return this.copyLinearToSRGB(this), this;
  }
  getHex() {
    return this.r * 255 << 16 ^ this.g * 255 << 8 ^ this.b * 255 << 0;
  }
  getHexString() {
    return ("000000" + this.getHex().toString(16)).slice(-6);
  }
  getHSL(target) {
    target === void 0 && (console.warn("THREE.Color: .getHSL() target is now required"), target = { h: 0, s: 0, l: 0 });
    let r = this.r, g = this.g, b = this.b, max = Math.max(r, g, b), min = Math.min(r, g, b), hue, saturation, lightness = (min + max) / 2;
    if (min === max)
      hue = 0, saturation = 0;
    else {
      let delta = max - min;
      switch (saturation = lightness <= 0.5 ? delta / (max + min) : delta / (2 - max - min), max) {
        case r:
          hue = (g - b) / delta + (g < b ? 6 : 0);
          break;
        case g:
          hue = (b - r) / delta + 2;
          break;
        case b:
          hue = (r - g) / delta + 4;
          break;
      }
      hue /= 6;
    }
    return target.h = hue, target.s = saturation, target.l = lightness, target;
  }
  getStyle() {
    return "rgb(" + (this.r * 255 | 0) + "," + (this.g * 255 | 0) + "," + (this.b * 255 | 0) + ")";
  }
  offsetHSL(h, s, l) {
    return this.getHSL(_hslA), _hslA.h += h, _hslA.s += s, _hslA.l += l, this.setHSL(_hslA.h, _hslA.s, _hslA.l), this;
  }
  add(color) {
    return this.r += color.r, this.g += color.g, this.b += color.b, this;
  }
  addColors(color1, color2) {
    return this.r = color1.r + color2.r, this.g = color1.g + color2.g, this.b = color1.b + color2.b, this;
  }
  addScalar(s) {
    return this.r += s, this.g += s, this.b += s, this;
  }
  sub(color) {
    return this.r = Math.max(0, this.r - color.r), this.g = Math.max(0, this.g - color.g), this.b = Math.max(0, this.b - color.b), this;
  }
  multiply(color) {
    return this.r *= color.r, this.g *= color.g, this.b *= color.b, this;
  }
  multiplyScalar(s) {
    return this.r *= s, this.g *= s, this.b *= s, this;
  }
  lerp(color, alpha) {
    return this.r += (color.r - this.r) * alpha, this.g += (color.g - this.g) * alpha, this.b += (color.b - this.b) * alpha, this;
  }
  lerpColors(color1, color2, alpha) {
    return this.r = color1.r + (color2.r - color1.r) * alpha, this.g = color1.g + (color2.g - color1.g) * alpha, this.b = color1.b + (color2.b - color1.b) * alpha, this;
  }
  lerpHSL(color, alpha) {
    this.getHSL(_hslA), color.getHSL(_hslB);
    let h = lerp(_hslA.h, _hslB.h, alpha), s = lerp(_hslA.s, _hslB.s, alpha), l = lerp(_hslA.l, _hslB.l, alpha);
    return this.setHSL(h, s, l), this;
  }
  equals(c) {
    return c.r === this.r && c.g === this.g && c.b === this.b;
  }
  fromArray(array, offset = 0) {
    return this.r = array[offset], this.g = array[offset + 1], this.b = array[offset + 2], this;
  }
  toArray(array = [], offset = 0) {
    return array[offset] = this.r, array[offset + 1] = this.g, array[offset + 2] = this.b, array;
  }
  fromBufferAttribute(attribute, index) {
    return this.r = attribute.getX(index), this.g = attribute.getY(index), this.b = attribute.getZ(index), attribute.normalized === !0 && (this.r /= 255, this.g /= 255, this.b /= 255), this;
  }
  toJSON() {
    return this.getHex();
  }
};
Color.NAMES = _colorKeywords;
Color.prototype.isColor = !0;
Color.prototype.r = 1;
Color.prototype.g = 1;
Color.prototype.b = 1;
var MeshBasicMaterial = class extends Material {
  constructor(parameters) {
    super();
    this.type = "MeshBasicMaterial", this.color = new Color(16777215), this.map = null, this.lightMap = null, this.lightMapIntensity = 1, this.aoMap = null, this.aoMapIntensity = 1, this.specularMap = null, this.alphaMap = null, this.envMap = null, this.combine = MultiplyOperation, this.reflectivity = 1, this.refractionRatio = 0.98, this.wireframe = !1, this.wireframeLinewidth = 1, this.wireframeLinecap = "round", this.wireframeLinejoin = "round", this.morphTargets = !1, this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.color.copy(source.color), this.map = source.map, this.lightMap = source.lightMap, this.lightMapIntensity = source.lightMapIntensity, this.aoMap = source.aoMap, this.aoMapIntensity = source.aoMapIntensity, this.specularMap = source.specularMap, this.alphaMap = source.alphaMap, this.envMap = source.envMap, this.combine = source.combine, this.reflectivity = source.reflectivity, this.refractionRatio = source.refractionRatio, this.wireframe = source.wireframe, this.wireframeLinewidth = source.wireframeLinewidth, this.wireframeLinecap = source.wireframeLinecap, this.wireframeLinejoin = source.wireframeLinejoin, this.morphTargets = source.morphTargets, this;
  }
};
MeshBasicMaterial.prototype.isMeshBasicMaterial = !0;
var _vector$9 = /* @__PURE__ */ new Vector3(), _vector2 = /* @__PURE__ */ new Vector2(), BufferAttribute = class {
  constructor(array, itemSize, normalized) {
    if (Array.isArray(array))
      throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");
    this.name = "", this.array = array, this.itemSize = itemSize, this.count = array !== void 0 ? array.length / itemSize : 0, this.normalized = normalized === !0, this.usage = StaticDrawUsage, this.updateRange = { offset: 0, count: -1 }, this.version = 0;
  }
  onUploadCallback() {
  }
  set needsUpdate(value) {
    value === !0 && this.version++;
  }
  setUsage(value) {
    return this.usage = value, this;
  }
  copy(source) {
    return this.name = source.name, this.array = new source.array.constructor(source.array), this.itemSize = source.itemSize, this.count = source.count, this.normalized = source.normalized, this.usage = source.usage, this;
  }
  copyAt(index1, attribute, index2) {
    index1 *= this.itemSize, index2 *= attribute.itemSize;
    for (let i = 0, l = this.itemSize; i < l; i++)
      this.array[index1 + i] = attribute.array[index2 + i];
    return this;
  }
  copyArray(array) {
    return this.array.set(array), this;
  }
  copyColorsArray(colors) {
    let array = this.array, offset = 0;
    for (let i = 0, l = colors.length; i < l; i++) {
      let color = colors[i];
      color === void 0 && (console.warn("THREE.BufferAttribute.copyColorsArray(): color is undefined", i), color = new Color()), array[offset++] = color.r, array[offset++] = color.g, array[offset++] = color.b;
    }
    return this;
  }
  copyVector2sArray(vectors) {
    let array = this.array, offset = 0;
    for (let i = 0, l = vectors.length; i < l; i++) {
      let vector = vectors[i];
      vector === void 0 && (console.warn("THREE.BufferAttribute.copyVector2sArray(): vector is undefined", i), vector = new Vector2()), array[offset++] = vector.x, array[offset++] = vector.y;
    }
    return this;
  }
  copyVector3sArray(vectors) {
    let array = this.array, offset = 0;
    for (let i = 0, l = vectors.length; i < l; i++) {
      let vector = vectors[i];
      vector === void 0 && (console.warn("THREE.BufferAttribute.copyVector3sArray(): vector is undefined", i), vector = new Vector3()), array[offset++] = vector.x, array[offset++] = vector.y, array[offset++] = vector.z;
    }
    return this;
  }
  copyVector4sArray(vectors) {
    let array = this.array, offset = 0;
    for (let i = 0, l = vectors.length; i < l; i++) {
      let vector = vectors[i];
      vector === void 0 && (console.warn("THREE.BufferAttribute.copyVector4sArray(): vector is undefined", i), vector = new Vector4()), array[offset++] = vector.x, array[offset++] = vector.y, array[offset++] = vector.z, array[offset++] = vector.w;
    }
    return this;
  }
  applyMatrix3(m) {
    if (this.itemSize === 2)
      for (let i = 0, l = this.count; i < l; i++)
        _vector2.fromBufferAttribute(this, i), _vector2.applyMatrix3(m), this.setXY(i, _vector2.x, _vector2.y);
    else if (this.itemSize === 3)
      for (let i = 0, l = this.count; i < l; i++)
        _vector$9.fromBufferAttribute(this, i), _vector$9.applyMatrix3(m), this.setXYZ(i, _vector$9.x, _vector$9.y, _vector$9.z);
    return this;
  }
  applyMatrix4(m) {
    for (let i = 0, l = this.count; i < l; i++)
      _vector$9.x = this.getX(i), _vector$9.y = this.getY(i), _vector$9.z = this.getZ(i), _vector$9.applyMatrix4(m), this.setXYZ(i, _vector$9.x, _vector$9.y, _vector$9.z);
    return this;
  }
  applyNormalMatrix(m) {
    for (let i = 0, l = this.count; i < l; i++)
      _vector$9.x = this.getX(i), _vector$9.y = this.getY(i), _vector$9.z = this.getZ(i), _vector$9.applyNormalMatrix(m), this.setXYZ(i, _vector$9.x, _vector$9.y, _vector$9.z);
    return this;
  }
  transformDirection(m) {
    for (let i = 0, l = this.count; i < l; i++)
      _vector$9.x = this.getX(i), _vector$9.y = this.getY(i), _vector$9.z = this.getZ(i), _vector$9.transformDirection(m), this.setXYZ(i, _vector$9.x, _vector$9.y, _vector$9.z);
    return this;
  }
  set(value, offset = 0) {
    return this.array.set(value, offset), this;
  }
  getX(index) {
    return this.array[index * this.itemSize];
  }
  setX(index, x) {
    return this.array[index * this.itemSize] = x, this;
  }
  getY(index) {
    return this.array[index * this.itemSize + 1];
  }
  setY(index, y) {
    return this.array[index * this.itemSize + 1] = y, this;
  }
  getZ(index) {
    return this.array[index * this.itemSize + 2];
  }
  setZ(index, z) {
    return this.array[index * this.itemSize + 2] = z, this;
  }
  getW(index) {
    return this.array[index * this.itemSize + 3];
  }
  setW(index, w) {
    return this.array[index * this.itemSize + 3] = w, this;
  }
  setXY(index, x, y) {
    return index *= this.itemSize, this.array[index + 0] = x, this.array[index + 1] = y, this;
  }
  setXYZ(index, x, y, z) {
    return index *= this.itemSize, this.array[index + 0] = x, this.array[index + 1] = y, this.array[index + 2] = z, this;
  }
  setXYZW(index, x, y, z, w) {
    return index *= this.itemSize, this.array[index + 0] = x, this.array[index + 1] = y, this.array[index + 2] = z, this.array[index + 3] = w, this;
  }
  onUpload(callback) {
    return this.onUploadCallback = callback, this;
  }
  clone() {
    return new this.constructor(this.array, this.itemSize).copy(this);
  }
  toJSON() {
    let data = {
      itemSize: this.itemSize,
      type: this.array.constructor.name,
      array: Array.prototype.slice.call(this.array),
      normalized: this.normalized
    };
    return this.name !== "" && (data.name = this.name), this.usage !== StaticDrawUsage && (data.usage = this.usage), (this.updateRange.offset !== 0 || this.updateRange.count !== -1) && (data.updateRange = this.updateRange), data;
  }
};
BufferAttribute.prototype.isBufferAttribute = !0;
var Uint16BufferAttribute = class extends BufferAttribute {
  constructor(array, itemSize, normalized) {
    super(new Uint16Array(array), itemSize, normalized);
  }
};
var Uint32BufferAttribute = class extends BufferAttribute {
  constructor(array, itemSize, normalized) {
    super(new Uint32Array(array), itemSize, normalized);
  }
}, Float16BufferAttribute = class extends BufferAttribute {
  constructor(array, itemSize, normalized) {
    super(new Uint16Array(array), itemSize, normalized);
  }
};
Float16BufferAttribute.prototype.isFloat16BufferAttribute = !0;
var Float32BufferAttribute = class extends BufferAttribute {
  constructor(array, itemSize, normalized) {
    super(new Float32Array(array), itemSize, normalized);
  }
};
function arrayMax(array) {
  if (array.length === 0)
    return -Infinity;
  let max = array[0];
  for (let i = 1, l = array.length; i < l; ++i)
    array[i] > max && (max = array[i]);
  return max;
}
var _id = 0, _m1 = /* @__PURE__ */ new Matrix4(), _obj = /* @__PURE__ */ new Object3D(), _offset = /* @__PURE__ */ new Vector3(), _box$1 = /* @__PURE__ */ new Box3(), _boxMorphTargets = /* @__PURE__ */ new Box3(), _vector$8 = /* @__PURE__ */ new Vector3(), BufferGeometry = class extends EventDispatcher {
  constructor() {
    super();
    Object.defineProperty(this, "id", { value: _id++ }), this.uuid = generateUUID(), this.name = "", this.type = "BufferGeometry", this.index = null, this.attributes = {}, this.morphAttributes = {}, this.morphTargetsRelative = !1, this.groups = [], this.boundingBox = null, this.boundingSphere = null, this.drawRange = { start: 0, count: Infinity }, this.userData = {};
  }
  getIndex() {
    return this.index;
  }
  setIndex(index) {
    return Array.isArray(index) ? this.index = new (arrayMax(index) > 65535 ? Uint32BufferAttribute : Uint16BufferAttribute)(index, 1) : this.index = index, this;
  }
  getAttribute(name) {
    return this.attributes[name];
  }
  setAttribute(name, attribute) {
    return this.attributes[name] = attribute, this;
  }
  deleteAttribute(name) {
    return delete this.attributes[name], this;
  }
  hasAttribute(name) {
    return this.attributes[name] !== void 0;
  }
  addGroup(start, count, materialIndex = 0) {
    this.groups.push({
      start,
      count,
      materialIndex
    });
  }
  clearGroups() {
    this.groups = [];
  }
  setDrawRange(start, count) {
    this.drawRange.start = start, this.drawRange.count = count;
  }
  applyMatrix4(matrix) {
    let position = this.attributes.position;
    position !== void 0 && (position.applyMatrix4(matrix), position.needsUpdate = !0);
    let normal = this.attributes.normal;
    if (normal !== void 0) {
      let normalMatrix = new Matrix3().getNormalMatrix(matrix);
      normal.applyNormalMatrix(normalMatrix), normal.needsUpdate = !0;
    }
    let tangent = this.attributes.tangent;
    return tangent !== void 0 && (tangent.transformDirection(matrix), tangent.needsUpdate = !0), this.boundingBox !== null && this.computeBoundingBox(), this.boundingSphere !== null && this.computeBoundingSphere(), this;
  }
  applyQuaternion(q) {
    return _m1.makeRotationFromQuaternion(q), this.applyMatrix4(_m1), this;
  }
  rotateX(angle) {
    return _m1.makeRotationX(angle), this.applyMatrix4(_m1), this;
  }
  rotateY(angle) {
    return _m1.makeRotationY(angle), this.applyMatrix4(_m1), this;
  }
  rotateZ(angle) {
    return _m1.makeRotationZ(angle), this.applyMatrix4(_m1), this;
  }
  translate(x, y, z) {
    return _m1.makeTranslation(x, y, z), this.applyMatrix4(_m1), this;
  }
  scale(x, y, z) {
    return _m1.makeScale(x, y, z), this.applyMatrix4(_m1), this;
  }
  lookAt(vector) {
    return _obj.lookAt(vector), _obj.updateMatrix(), this.applyMatrix4(_obj.matrix), this;
  }
  center() {
    return this.computeBoundingBox(), this.boundingBox.getCenter(_offset).negate(), this.translate(_offset.x, _offset.y, _offset.z), this;
  }
  setFromPoints(points) {
    let position = [];
    for (let i = 0, l = points.length; i < l; i++) {
      let point = points[i];
      position.push(point.x, point.y, point.z || 0);
    }
    return this.setAttribute("position", new Float32BufferAttribute(position, 3)), this;
  }
  computeBoundingBox() {
    this.boundingBox === null && (this.boundingBox = new Box3());
    let position = this.attributes.position, morphAttributesPosition = this.morphAttributes.position;
    if (position && position.isGLBufferAttribute) {
      console.error('THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box. Alternatively set "mesh.frustumCulled" to "false".', this), this.boundingBox.set(new Vector3(-Infinity, -Infinity, -Infinity), new Vector3(Infinity, Infinity, Infinity));
      return;
    }
    if (position !== void 0) {
      if (this.boundingBox.setFromBufferAttribute(position), morphAttributesPosition)
        for (let i = 0, il = morphAttributesPosition.length; i < il; i++) {
          let morphAttribute = morphAttributesPosition[i];
          _box$1.setFromBufferAttribute(morphAttribute), this.morphTargetsRelative ? (_vector$8.addVectors(this.boundingBox.min, _box$1.min), this.boundingBox.expandByPoint(_vector$8), _vector$8.addVectors(this.boundingBox.max, _box$1.max), this.boundingBox.expandByPoint(_vector$8)) : (this.boundingBox.expandByPoint(_box$1.min), this.boundingBox.expandByPoint(_box$1.max));
        }
    } else
      this.boundingBox.makeEmpty();
    (isNaN(this.boundingBox.min.x) || isNaN(this.boundingBox.min.y) || isNaN(this.boundingBox.min.z)) && console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.', this);
  }
  computeBoundingSphere() {
    this.boundingSphere === null && (this.boundingSphere = new Sphere());
    let position = this.attributes.position, morphAttributesPosition = this.morphAttributes.position;
    if (position && position.isGLBufferAttribute) {
      console.error('THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere. Alternatively set "mesh.frustumCulled" to "false".', this), this.boundingSphere.set(new Vector3(), Infinity);
      return;
    }
    if (position) {
      let center = this.boundingSphere.center;
      if (_box$1.setFromBufferAttribute(position), morphAttributesPosition)
        for (let i = 0, il = morphAttributesPosition.length; i < il; i++) {
          let morphAttribute = morphAttributesPosition[i];
          _boxMorphTargets.setFromBufferAttribute(morphAttribute), this.morphTargetsRelative ? (_vector$8.addVectors(_box$1.min, _boxMorphTargets.min), _box$1.expandByPoint(_vector$8), _vector$8.addVectors(_box$1.max, _boxMorphTargets.max), _box$1.expandByPoint(_vector$8)) : (_box$1.expandByPoint(_boxMorphTargets.min), _box$1.expandByPoint(_boxMorphTargets.max));
        }
      _box$1.getCenter(center);
      let maxRadiusSq = 0;
      for (let i = 0, il = position.count; i < il; i++)
        _vector$8.fromBufferAttribute(position, i), maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector$8));
      if (morphAttributesPosition)
        for (let i = 0, il = morphAttributesPosition.length; i < il; i++) {
          let morphAttribute = morphAttributesPosition[i], morphTargetsRelative = this.morphTargetsRelative;
          for (let j = 0, jl = morphAttribute.count; j < jl; j++)
            _vector$8.fromBufferAttribute(morphAttribute, j), morphTargetsRelative && (_offset.fromBufferAttribute(position, j), _vector$8.add(_offset)), maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector$8));
        }
      this.boundingSphere.radius = Math.sqrt(maxRadiusSq), isNaN(this.boundingSphere.radius) && console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.', this);
    }
  }
  computeFaceNormals() {
  }
  computeTangents() {
    let index = this.index, attributes = this.attributes;
    if (index === null || attributes.position === void 0 || attributes.normal === void 0 || attributes.uv === void 0) {
      console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");
      return;
    }
    let indices = index.array, positions = attributes.position.array, normals = attributes.normal.array, uvs = attributes.uv.array, nVertices = positions.length / 3;
    attributes.tangent === void 0 && this.setAttribute("tangent", new BufferAttribute(new Float32Array(4 * nVertices), 4));
    let tangents = attributes.tangent.array, tan1 = [], tan2 = [];
    for (let i = 0; i < nVertices; i++)
      tan1[i] = new Vector3(), tan2[i] = new Vector3();
    let vA = new Vector3(), vB = new Vector3(), vC = new Vector3(), uvA = new Vector2(), uvB = new Vector2(), uvC = new Vector2(), sdir = new Vector3(), tdir = new Vector3();
    function handleTriangle(a, b, c) {
      vA.fromArray(positions, a * 3), vB.fromArray(positions, b * 3), vC.fromArray(positions, c * 3), uvA.fromArray(uvs, a * 2), uvB.fromArray(uvs, b * 2), uvC.fromArray(uvs, c * 2), vB.sub(vA), vC.sub(vA), uvB.sub(uvA), uvC.sub(uvA);
      let r = 1 / (uvB.x * uvC.y - uvC.x * uvB.y);
      !isFinite(r) || (sdir.copy(vB).multiplyScalar(uvC.y).addScaledVector(vC, -uvB.y).multiplyScalar(r), tdir.copy(vC).multiplyScalar(uvB.x).addScaledVector(vB, -uvC.x).multiplyScalar(r), tan1[a].add(sdir), tan1[b].add(sdir), tan1[c].add(sdir), tan2[a].add(tdir), tan2[b].add(tdir), tan2[c].add(tdir));
    }
    let groups = this.groups;
    groups.length === 0 && (groups = [{
      start: 0,
      count: indices.length
    }]);
    for (let i = 0, il = groups.length; i < il; ++i) {
      let group = groups[i], start = group.start, count = group.count;
      for (let j = start, jl = start + count; j < jl; j += 3)
        handleTriangle(indices[j + 0], indices[j + 1], indices[j + 2]);
    }
    let tmp2 = new Vector3(), tmp22 = new Vector3(), n = new Vector3(), n2 = new Vector3();
    function handleVertex(v) {
      n.fromArray(normals, v * 3), n2.copy(n);
      let t = tan1[v];
      tmp2.copy(t), tmp2.sub(n.multiplyScalar(n.dot(t))).normalize(), tmp22.crossVectors(n2, t);
      let w = tmp22.dot(tan2[v]) < 0 ? -1 : 1;
      tangents[v * 4] = tmp2.x, tangents[v * 4 + 1] = tmp2.y, tangents[v * 4 + 2] = tmp2.z, tangents[v * 4 + 3] = w;
    }
    for (let i = 0, il = groups.length; i < il; ++i) {
      let group = groups[i], start = group.start, count = group.count;
      for (let j = start, jl = start + count; j < jl; j += 3)
        handleVertex(indices[j + 0]), handleVertex(indices[j + 1]), handleVertex(indices[j + 2]);
    }
  }
  computeVertexNormals() {
    let index = this.index, positionAttribute = this.getAttribute("position");
    if (positionAttribute !== void 0) {
      let normalAttribute = this.getAttribute("normal");
      if (normalAttribute === void 0)
        normalAttribute = new BufferAttribute(new Float32Array(positionAttribute.count * 3), 3), this.setAttribute("normal", normalAttribute);
      else
        for (let i = 0, il = normalAttribute.count; i < il; i++)
          normalAttribute.setXYZ(i, 0, 0, 0);
      let pA = new Vector3(), pB = new Vector3(), pC = new Vector3(), nA = new Vector3(), nB = new Vector3(), nC = new Vector3(), cb = new Vector3(), ab = new Vector3();
      if (index)
        for (let i = 0, il = index.count; i < il; i += 3) {
          let vA = index.getX(i + 0), vB = index.getX(i + 1), vC = index.getX(i + 2);
          pA.fromBufferAttribute(positionAttribute, vA), pB.fromBufferAttribute(positionAttribute, vB), pC.fromBufferAttribute(positionAttribute, vC), cb.subVectors(pC, pB), ab.subVectors(pA, pB), cb.cross(ab), nA.fromBufferAttribute(normalAttribute, vA), nB.fromBufferAttribute(normalAttribute, vB), nC.fromBufferAttribute(normalAttribute, vC), nA.add(cb), nB.add(cb), nC.add(cb), normalAttribute.setXYZ(vA, nA.x, nA.y, nA.z), normalAttribute.setXYZ(vB, nB.x, nB.y, nB.z), normalAttribute.setXYZ(vC, nC.x, nC.y, nC.z);
        }
      else
        for (let i = 0, il = positionAttribute.count; i < il; i += 3)
          pA.fromBufferAttribute(positionAttribute, i + 0), pB.fromBufferAttribute(positionAttribute, i + 1), pC.fromBufferAttribute(positionAttribute, i + 2), cb.subVectors(pC, pB), ab.subVectors(pA, pB), cb.cross(ab), normalAttribute.setXYZ(i + 0, cb.x, cb.y, cb.z), normalAttribute.setXYZ(i + 1, cb.x, cb.y, cb.z), normalAttribute.setXYZ(i + 2, cb.x, cb.y, cb.z);
      this.normalizeNormals(), normalAttribute.needsUpdate = !0;
    }
  }
  merge(geometry, offset) {
    if (!(geometry && geometry.isBufferGeometry)) {
      console.error("THREE.BufferGeometry.merge(): geometry not an instance of THREE.BufferGeometry.", geometry);
      return;
    }
    offset === void 0 && (offset = 0, console.warn("THREE.BufferGeometry.merge(): Overwriting original geometry, starting at offset=0. Use BufferGeometryUtils.mergeBufferGeometries() for lossless merge."));
    let attributes = this.attributes;
    for (let key in attributes) {
      if (geometry.attributes[key] === void 0)
        continue;
      let attributeArray1 = attributes[key].array, attribute2 = geometry.attributes[key], attributeArray2 = attribute2.array, attributeOffset = attribute2.itemSize * offset, length = Math.min(attributeArray2.length, attributeArray1.length - attributeOffset);
      for (let i = 0, j = attributeOffset; i < length; i++, j++)
        attributeArray1[j] = attributeArray2[i];
    }
    return this;
  }
  normalizeNormals() {
    let normals = this.attributes.normal;
    for (let i = 0, il = normals.count; i < il; i++)
      _vector$8.fromBufferAttribute(normals, i), _vector$8.normalize(), normals.setXYZ(i, _vector$8.x, _vector$8.y, _vector$8.z);
  }
  toNonIndexed() {
    function convertBufferAttribute(attribute, indices2) {
      let array = attribute.array, itemSize = attribute.itemSize, normalized = attribute.normalized, array2 = new array.constructor(indices2.length * itemSize), index = 0, index2 = 0;
      for (let i = 0, l = indices2.length; i < l; i++) {
        index = indices2[i] * itemSize;
        for (let j = 0; j < itemSize; j++)
          array2[index2++] = array[index++];
      }
      return new BufferAttribute(array2, itemSize, normalized);
    }
    if (this.index === null)
      return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."), this;
    let geometry2 = new BufferGeometry(), indices = this.index.array, attributes = this.attributes;
    for (let name in attributes) {
      let attribute = attributes[name], newAttribute = convertBufferAttribute(attribute, indices);
      geometry2.setAttribute(name, newAttribute);
    }
    let morphAttributes = this.morphAttributes;
    for (let name in morphAttributes) {
      let morphArray = [], morphAttribute = morphAttributes[name];
      for (let i = 0, il = morphAttribute.length; i < il; i++) {
        let attribute = morphAttribute[i], newAttribute = convertBufferAttribute(attribute, indices);
        morphArray.push(newAttribute);
      }
      geometry2.morphAttributes[name] = morphArray;
    }
    geometry2.morphTargetsRelative = this.morphTargetsRelative;
    let groups = this.groups;
    for (let i = 0, l = groups.length; i < l; i++) {
      let group = groups[i];
      geometry2.addGroup(group.start, group.count, group.materialIndex);
    }
    return geometry2;
  }
  toJSON() {
    let data = {
      metadata: {
        version: 4.5,
        type: "BufferGeometry",
        generator: "BufferGeometry.toJSON"
      }
    };
    if (data.uuid = this.uuid, data.type = this.type, this.name !== "" && (data.name = this.name), Object.keys(this.userData).length > 0 && (data.userData = this.userData), this.parameters !== void 0) {
      let parameters = this.parameters;
      for (let key in parameters)
        parameters[key] !== void 0 && (data[key] = parameters[key]);
      return data;
    }
    data.data = { attributes: {} };
    let index = this.index;
    index !== null && (data.data.index = {
      type: index.array.constructor.name,
      array: Array.prototype.slice.call(index.array)
    });
    let attributes = this.attributes;
    for (let key in attributes) {
      let attribute = attributes[key];
      data.data.attributes[key] = attribute.toJSON(data.data);
    }
    let morphAttributes = {}, hasMorphAttributes = !1;
    for (let key in this.morphAttributes) {
      let attributeArray = this.morphAttributes[key], array = [];
      for (let i = 0, il = attributeArray.length; i < il; i++) {
        let attribute = attributeArray[i];
        array.push(attribute.toJSON(data.data));
      }
      array.length > 0 && (morphAttributes[key] = array, hasMorphAttributes = !0);
    }
    hasMorphAttributes && (data.data.morphAttributes = morphAttributes, data.data.morphTargetsRelative = this.morphTargetsRelative);
    let groups = this.groups;
    groups.length > 0 && (data.data.groups = JSON.parse(JSON.stringify(groups)));
    let boundingSphere = this.boundingSphere;
    return boundingSphere !== null && (data.data.boundingSphere = {
      center: boundingSphere.center.toArray(),
      radius: boundingSphere.radius
    }), data;
  }
  clone() {
    return new BufferGeometry().copy(this);
  }
  copy(source) {
    this.index = null, this.attributes = {}, this.morphAttributes = {}, this.groups = [], this.boundingBox = null, this.boundingSphere = null;
    let data = {};
    this.name = source.name;
    let index = source.index;
    index !== null && this.setIndex(index.clone(data));
    let attributes = source.attributes;
    for (let name in attributes) {
      let attribute = attributes[name];
      this.setAttribute(name, attribute.clone(data));
    }
    let morphAttributes = source.morphAttributes;
    for (let name in morphAttributes) {
      let array = [], morphAttribute = morphAttributes[name];
      for (let i = 0, l = morphAttribute.length; i < l; i++)
        array.push(morphAttribute[i].clone(data));
      this.morphAttributes[name] = array;
    }
    this.morphTargetsRelative = source.morphTargetsRelative;
    let groups = source.groups;
    for (let i = 0, l = groups.length; i < l; i++) {
      let group = groups[i];
      this.addGroup(group.start, group.count, group.materialIndex);
    }
    let boundingBox = source.boundingBox;
    boundingBox !== null && (this.boundingBox = boundingBox.clone());
    let boundingSphere = source.boundingSphere;
    return boundingSphere !== null && (this.boundingSphere = boundingSphere.clone()), this.drawRange.start = source.drawRange.start, this.drawRange.count = source.drawRange.count, this.userData = source.userData, this;
  }
  dispose() {
    this.dispatchEvent({ type: "dispose" });
  }
};
BufferGeometry.prototype.isBufferGeometry = !0;
var _inverseMatrix$2 = /* @__PURE__ */ new Matrix4(), _ray$2 = /* @__PURE__ */ new Ray(), _sphere$3 = /* @__PURE__ */ new Sphere(), _vA$1 = /* @__PURE__ */ new Vector3(), _vB$1 = /* @__PURE__ */ new Vector3(), _vC$1 = /* @__PURE__ */ new Vector3(), _tempA = /* @__PURE__ */ new Vector3(), _tempB = /* @__PURE__ */ new Vector3(), _tempC = /* @__PURE__ */ new Vector3(), _morphA = /* @__PURE__ */ new Vector3(), _morphB = /* @__PURE__ */ new Vector3(), _morphC = /* @__PURE__ */ new Vector3(), _uvA$1 = /* @__PURE__ */ new Vector2(), _uvB$1 = /* @__PURE__ */ new Vector2(), _uvC$1 = /* @__PURE__ */ new Vector2(), _intersectionPoint = /* @__PURE__ */ new Vector3(), _intersectionPointWorld = /* @__PURE__ */ new Vector3(), Mesh = class extends Object3D {
  constructor(geometry = new BufferGeometry(), material = new MeshBasicMaterial()) {
    super();
    this.type = "Mesh", this.geometry = geometry, this.material = material, this.updateMorphTargets();
  }
  copy(source) {
    return super.copy(source), source.morphTargetInfluences !== void 0 && (this.morphTargetInfluences = source.morphTargetInfluences.slice()), source.morphTargetDictionary !== void 0 && (this.morphTargetDictionary = Object.assign({}, source.morphTargetDictionary)), this.material = source.material, this.geometry = source.geometry, this;
  }
  updateMorphTargets() {
    let geometry = this.geometry;
    if (geometry.isBufferGeometry) {
      let morphAttributes = geometry.morphAttributes, keys = Object.keys(morphAttributes);
      if (keys.length > 0) {
        let morphAttribute = morphAttributes[keys[0]];
        if (morphAttribute !== void 0) {
          this.morphTargetInfluences = [], this.morphTargetDictionary = {};
          for (let m = 0, ml = morphAttribute.length; m < ml; m++) {
            let name = morphAttribute[m].name || String(m);
            this.morphTargetInfluences.push(0), this.morphTargetDictionary[name] = m;
          }
        }
      }
    } else {
      let morphTargets = geometry.morphTargets;
      morphTargets !== void 0 && morphTargets.length > 0 && console.error("THREE.Mesh.updateMorphTargets() no longer supports THREE.Geometry. Use THREE.BufferGeometry instead.");
    }
  }
  raycast(raycaster, intersects2) {
    let geometry = this.geometry, material = this.material, matrixWorld = this.matrixWorld;
    if (material === void 0 || (geometry.boundingSphere === null && geometry.computeBoundingSphere(), _sphere$3.copy(geometry.boundingSphere), _sphere$3.applyMatrix4(matrixWorld), raycaster.ray.intersectsSphere(_sphere$3) === !1) || (_inverseMatrix$2.copy(matrixWorld).invert(), _ray$2.copy(raycaster.ray).applyMatrix4(_inverseMatrix$2), geometry.boundingBox !== null && _ray$2.intersectsBox(geometry.boundingBox) === !1))
      return;
    let intersection;
    if (geometry.isBufferGeometry) {
      let index = geometry.index, position = geometry.attributes.position, morphPosition = geometry.morphAttributes.position, morphTargetsRelative = geometry.morphTargetsRelative, uv = geometry.attributes.uv, uv2 = geometry.attributes.uv2, groups = geometry.groups, drawRange = geometry.drawRange;
      if (index !== null)
        if (Array.isArray(material))
          for (let i = 0, il = groups.length; i < il; i++) {
            let group = groups[i], groupMaterial = material[group.materialIndex], start = Math.max(group.start, drawRange.start), end = Math.min(group.start + group.count, drawRange.start + drawRange.count);
            for (let j = start, jl = end; j < jl; j += 3) {
              let a = index.getX(j), b = index.getX(j + 1), c = index.getX(j + 2);
              intersection = checkBufferGeometryIntersection(this, groupMaterial, raycaster, _ray$2, position, morphPosition, morphTargetsRelative, uv, uv2, a, b, c), intersection && (intersection.faceIndex = Math.floor(j / 3), intersection.face.materialIndex = group.materialIndex, intersects2.push(intersection));
            }
          }
        else {
          let start = Math.max(0, drawRange.start), end = Math.min(index.count, drawRange.start + drawRange.count);
          for (let i = start, il = end; i < il; i += 3) {
            let a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
            intersection = checkBufferGeometryIntersection(this, material, raycaster, _ray$2, position, morphPosition, morphTargetsRelative, uv, uv2, a, b, c), intersection && (intersection.faceIndex = Math.floor(i / 3), intersects2.push(intersection));
          }
        }
      else if (position !== void 0)
        if (Array.isArray(material))
          for (let i = 0, il = groups.length; i < il; i++) {
            let group = groups[i], groupMaterial = material[group.materialIndex], start = Math.max(group.start, drawRange.start), end = Math.min(group.start + group.count, drawRange.start + drawRange.count);
            for (let j = start, jl = end; j < jl; j += 3) {
              let a = j, b = j + 1, c = j + 2;
              intersection = checkBufferGeometryIntersection(this, groupMaterial, raycaster, _ray$2, position, morphPosition, morphTargetsRelative, uv, uv2, a, b, c), intersection && (intersection.faceIndex = Math.floor(j / 3), intersection.face.materialIndex = group.materialIndex, intersects2.push(intersection));
            }
          }
        else {
          let start = Math.max(0, drawRange.start), end = Math.min(position.count, drawRange.start + drawRange.count);
          for (let i = start, il = end; i < il; i += 3) {
            let a = i, b = i + 1, c = i + 2;
            intersection = checkBufferGeometryIntersection(this, material, raycaster, _ray$2, position, morphPosition, morphTargetsRelative, uv, uv2, a, b, c), intersection && (intersection.faceIndex = Math.floor(i / 3), intersects2.push(intersection));
          }
        }
    } else
      geometry.isGeometry && console.error("THREE.Mesh.raycast() no longer supports THREE.Geometry. Use THREE.BufferGeometry instead.");
  }
};
Mesh.prototype.isMesh = !0;
function checkIntersection(object, material, raycaster, ray, pA, pB, pC, point) {
  let intersect;
  if (material.side === BackSide ? intersect = ray.intersectTriangle(pC, pB, pA, !0, point) : intersect = ray.intersectTriangle(pA, pB, pC, material.side !== DoubleSide, point), intersect === null)
    return null;
  _intersectionPointWorld.copy(point), _intersectionPointWorld.applyMatrix4(object.matrixWorld);
  let distance = raycaster.ray.origin.distanceTo(_intersectionPointWorld);
  return distance < raycaster.near || distance > raycaster.far ? null : {
    distance,
    point: _intersectionPointWorld.clone(),
    object
  };
}
function checkBufferGeometryIntersection(object, material, raycaster, ray, position, morphPosition, morphTargetsRelative, uv, uv2, a, b, c) {
  _vA$1.fromBufferAttribute(position, a), _vB$1.fromBufferAttribute(position, b), _vC$1.fromBufferAttribute(position, c);
  let morphInfluences = object.morphTargetInfluences;
  if (material.morphTargets && morphPosition && morphInfluences) {
    _morphA.set(0, 0, 0), _morphB.set(0, 0, 0), _morphC.set(0, 0, 0);
    for (let i = 0, il = morphPosition.length; i < il; i++) {
      let influence = morphInfluences[i], morphAttribute = morphPosition[i];
      influence !== 0 && (_tempA.fromBufferAttribute(morphAttribute, a), _tempB.fromBufferAttribute(morphAttribute, b), _tempC.fromBufferAttribute(morphAttribute, c), morphTargetsRelative ? (_morphA.addScaledVector(_tempA, influence), _morphB.addScaledVector(_tempB, influence), _morphC.addScaledVector(_tempC, influence)) : (_morphA.addScaledVector(_tempA.sub(_vA$1), influence), _morphB.addScaledVector(_tempB.sub(_vB$1), influence), _morphC.addScaledVector(_tempC.sub(_vC$1), influence)));
    }
    _vA$1.add(_morphA), _vB$1.add(_morphB), _vC$1.add(_morphC);
  }
  object.isSkinnedMesh && (object.boneTransform(a, _vA$1), object.boneTransform(b, _vB$1), object.boneTransform(c, _vC$1));
  let intersection = checkIntersection(object, material, raycaster, ray, _vA$1, _vB$1, _vC$1, _intersectionPoint);
  if (intersection) {
    uv && (_uvA$1.fromBufferAttribute(uv, a), _uvB$1.fromBufferAttribute(uv, b), _uvC$1.fromBufferAttribute(uv, c), intersection.uv = Triangle.getUV(_intersectionPoint, _vA$1, _vB$1, _vC$1, _uvA$1, _uvB$1, _uvC$1, new Vector2())), uv2 && (_uvA$1.fromBufferAttribute(uv2, a), _uvB$1.fromBufferAttribute(uv2, b), _uvC$1.fromBufferAttribute(uv2, c), intersection.uv2 = Triangle.getUV(_intersectionPoint, _vA$1, _vB$1, _vC$1, _uvA$1, _uvB$1, _uvC$1, new Vector2()));
    let face = {
      a,
      b,
      c,
      normal: new Vector3(),
      materialIndex: 0
    };
    Triangle.getNormal(_vA$1, _vB$1, _vC$1, face.normal), intersection.face = face;
  }
  return intersection;
}
var BoxGeometry = class extends BufferGeometry {
  constructor(width = 1, height = 1, depth = 1, widthSegments = 1, heightSegments = 1, depthSegments = 1) {
    super();
    this.type = "BoxGeometry", this.parameters = {
      width,
      height,
      depth,
      widthSegments,
      heightSegments,
      depthSegments
    };
    let scope = this;
    widthSegments = Math.floor(widthSegments), heightSegments = Math.floor(heightSegments), depthSegments = Math.floor(depthSegments);
    let indices = [], vertices = [], normals = [], uvs = [], numberOfVertices = 0, groupStart = 0;
    buildPlane("z", "y", "x", -1, -1, depth, height, width, depthSegments, heightSegments, 0), buildPlane("z", "y", "x", 1, -1, depth, height, -width, depthSegments, heightSegments, 1), buildPlane("x", "z", "y", 1, 1, width, depth, height, widthSegments, depthSegments, 2), buildPlane("x", "z", "y", 1, -1, width, depth, -height, widthSegments, depthSegments, 3), buildPlane("x", "y", "z", 1, -1, width, height, depth, widthSegments, heightSegments, 4), buildPlane("x", "y", "z", -1, -1, width, height, -depth, widthSegments, heightSegments, 5), this.setIndex(indices), this.setAttribute("position", new Float32BufferAttribute(vertices, 3)), this.setAttribute("normal", new Float32BufferAttribute(normals, 3)), this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    function buildPlane(u, v, w, udir, vdir, width2, height2, depth2, gridX, gridY, materialIndex) {
      let segmentWidth = width2 / gridX, segmentHeight = height2 / gridY, widthHalf = width2 / 2, heightHalf = height2 / 2, depthHalf = depth2 / 2, gridX1 = gridX + 1, gridY1 = gridY + 1, vertexCounter = 0, groupCount = 0, vector = new Vector3();
      for (let iy = 0; iy < gridY1; iy++) {
        let y = iy * segmentHeight - heightHalf;
        for (let ix = 0; ix < gridX1; ix++) {
          let x = ix * segmentWidth - widthHalf;
          vector[u] = x * udir, vector[v] = y * vdir, vector[w] = depthHalf, vertices.push(vector.x, vector.y, vector.z), vector[u] = 0, vector[v] = 0, vector[w] = depth2 > 0 ? 1 : -1, normals.push(vector.x, vector.y, vector.z), uvs.push(ix / gridX), uvs.push(1 - iy / gridY), vertexCounter += 1;
        }
      }
      for (let iy = 0; iy < gridY; iy++)
        for (let ix = 0; ix < gridX; ix++) {
          let a = numberOfVertices + ix + gridX1 * iy, b = numberOfVertices + ix + gridX1 * (iy + 1), c = numberOfVertices + (ix + 1) + gridX1 * (iy + 1), d = numberOfVertices + (ix + 1) + gridX1 * iy;
          indices.push(a, b, d), indices.push(b, c, d), groupCount += 6;
        }
      scope.addGroup(groupStart, groupCount, materialIndex), groupStart += groupCount, numberOfVertices += vertexCounter;
    }
  }
};
function cloneUniforms(src) {
  let dst = {};
  for (let u in src) {
    dst[u] = {};
    for (let p in src[u]) {
      let property = src[u][p];
      property && (property.isColor || property.isMatrix3 || property.isMatrix4 || property.isVector2 || property.isVector3 || property.isVector4 || property.isTexture || property.isQuaternion) ? dst[u][p] = property.clone() : Array.isArray(property) ? dst[u][p] = property.slice() : dst[u][p] = property;
    }
  }
  return dst;
}
function mergeUniforms(uniforms) {
  let merged = {};
  for (let u = 0; u < uniforms.length; u++) {
    let tmp2 = cloneUniforms(uniforms[u]);
    for (let p in tmp2)
      merged[p] = tmp2[p];
  }
  return merged;
}
var UniformsUtils = { clone: cloneUniforms, merge: mergeUniforms }, default_vertex = `void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`, default_fragment = `void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`, ShaderMaterial = class extends Material {
  constructor(parameters) {
    super();
    this.type = "ShaderMaterial", this.defines = {}, this.uniforms = {}, this.vertexShader = default_vertex, this.fragmentShader = default_fragment, this.linewidth = 1, this.wireframe = !1, this.wireframeLinewidth = 1, this.fog = !1, this.lights = !1, this.clipping = !1, this.morphTargets = !1, this.morphNormals = !1, this.extensions = {
      derivatives: !1,
      fragDepth: !1,
      drawBuffers: !1,
      shaderTextureLOD: !1
    }, this.defaultAttributeValues = {
      color: [1, 1, 1],
      uv: [0, 0],
      uv2: [0, 0]
    }, this.index0AttributeName = void 0, this.uniformsNeedUpdate = !1, this.glslVersion = null, parameters !== void 0 && (parameters.attributes !== void 0 && console.error("THREE.ShaderMaterial: attributes should now be defined in THREE.BufferGeometry instead."), this.setValues(parameters));
  }
  copy(source) {
    return super.copy(source), this.fragmentShader = source.fragmentShader, this.vertexShader = source.vertexShader, this.uniforms = cloneUniforms(source.uniforms), this.defines = Object.assign({}, source.defines), this.wireframe = source.wireframe, this.wireframeLinewidth = source.wireframeLinewidth, this.lights = source.lights, this.clipping = source.clipping, this.morphTargets = source.morphTargets, this.morphNormals = source.morphNormals, this.extensions = Object.assign({}, source.extensions), this.glslVersion = source.glslVersion, this;
  }
  toJSON(meta) {
    let data = super.toJSON(meta);
    data.glslVersion = this.glslVersion, data.uniforms = {};
    for (let name in this.uniforms) {
      let value = this.uniforms[name].value;
      value && value.isTexture ? data.uniforms[name] = {
        type: "t",
        value: value.toJSON(meta).uuid
      } : value && value.isColor ? data.uniforms[name] = {
        type: "c",
        value: value.getHex()
      } : value && value.isVector2 ? data.uniforms[name] = {
        type: "v2",
        value: value.toArray()
      } : value && value.isVector3 ? data.uniforms[name] = {
        type: "v3",
        value: value.toArray()
      } : value && value.isVector4 ? data.uniforms[name] = {
        type: "v4",
        value: value.toArray()
      } : value && value.isMatrix3 ? data.uniforms[name] = {
        type: "m3",
        value: value.toArray()
      } : value && value.isMatrix4 ? data.uniforms[name] = {
        type: "m4",
        value: value.toArray()
      } : data.uniforms[name] = {
        value
      };
    }
    Object.keys(this.defines).length > 0 && (data.defines = this.defines), data.vertexShader = this.vertexShader, data.fragmentShader = this.fragmentShader;
    let extensions = {};
    for (let key in this.extensions)
      this.extensions[key] === !0 && (extensions[key] = !0);
    return Object.keys(extensions).length > 0 && (data.extensions = extensions), data;
  }
};
ShaderMaterial.prototype.isShaderMaterial = !0;
var Camera = class extends Object3D {
  constructor() {
    super();
    this.type = "Camera", this.matrixWorldInverse = new Matrix4(), this.projectionMatrix = new Matrix4(), this.projectionMatrixInverse = new Matrix4();
  }
  copy(source, recursive) {
    return super.copy(source, recursive), this.matrixWorldInverse.copy(source.matrixWorldInverse), this.projectionMatrix.copy(source.projectionMatrix), this.projectionMatrixInverse.copy(source.projectionMatrixInverse), this;
  }
  getWorldDirection(target) {
    target === void 0 && (console.warn("THREE.Camera: .getWorldDirection() target is now required"), target = new Vector3()), this.updateWorldMatrix(!0, !1);
    let e = this.matrixWorld.elements;
    return target.set(-e[8], -e[9], -e[10]).normalize();
  }
  updateMatrixWorld(force) {
    super.updateMatrixWorld(force), this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }
  updateWorldMatrix(updateParents, updateChildren) {
    super.updateWorldMatrix(updateParents, updateChildren), this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }
  clone() {
    return new this.constructor().copy(this);
  }
};
Camera.prototype.isCamera = !0;
var PerspectiveCamera = class extends Camera {
  constructor(fov2 = 50, aspect2 = 1, near = 0.1, far = 2e3) {
    super();
    this.type = "PerspectiveCamera", this.fov = fov2, this.zoom = 1, this.near = near, this.far = far, this.focus = 10, this.aspect = aspect2, this.view = null, this.filmGauge = 35, this.filmOffset = 0, this.updateProjectionMatrix();
  }
  copy(source, recursive) {
    return super.copy(source, recursive), this.fov = source.fov, this.zoom = source.zoom, this.near = source.near, this.far = source.far, this.focus = source.focus, this.aspect = source.aspect, this.view = source.view === null ? null : Object.assign({}, source.view), this.filmGauge = source.filmGauge, this.filmOffset = source.filmOffset, this;
  }
  setFocalLength(focalLength) {
    let vExtentSlope = 0.5 * this.getFilmHeight() / focalLength;
    this.fov = RAD2DEG * 2 * Math.atan(vExtentSlope), this.updateProjectionMatrix();
  }
  getFocalLength() {
    let vExtentSlope = Math.tan(DEG2RAD * 0.5 * this.fov);
    return 0.5 * this.getFilmHeight() / vExtentSlope;
  }
  getEffectiveFOV() {
    return RAD2DEG * 2 * Math.atan(Math.tan(DEG2RAD * 0.5 * this.fov) / this.zoom);
  }
  getFilmWidth() {
    return this.filmGauge * Math.min(this.aspect, 1);
  }
  getFilmHeight() {
    return this.filmGauge / Math.max(this.aspect, 1);
  }
  setViewOffset(fullWidth, fullHeight, x, y, width, height) {
    this.aspect = fullWidth / fullHeight, this.view === null && (this.view = {
      enabled: !0,
      fullWidth: 1,
      fullHeight: 1,
      offsetX: 0,
      offsetY: 0,
      width: 1,
      height: 1
    }), this.view.enabled = !0, this.view.fullWidth = fullWidth, this.view.fullHeight = fullHeight, this.view.offsetX = x, this.view.offsetY = y, this.view.width = width, this.view.height = height, this.updateProjectionMatrix();
  }
  clearViewOffset() {
    this.view !== null && (this.view.enabled = !1), this.updateProjectionMatrix();
  }
  updateProjectionMatrix() {
    let near = this.near, top = near * Math.tan(DEG2RAD * 0.5 * this.fov) / this.zoom, height = 2 * top, width = this.aspect * height, left = -0.5 * width, view = this.view;
    if (this.view !== null && this.view.enabled) {
      let fullWidth = view.fullWidth, fullHeight = view.fullHeight;
      left += view.offsetX * width / fullWidth, top -= view.offsetY * height / fullHeight, width *= view.width / fullWidth, height *= view.height / fullHeight;
    }
    let skew = this.filmOffset;
    skew !== 0 && (left += near * skew / this.getFilmWidth()), this.projectionMatrix.makePerspective(left, left + width, top, top - height, near, this.far), this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
  toJSON(meta) {
    let data = super.toJSON(meta);
    return data.object.fov = this.fov, data.object.zoom = this.zoom, data.object.near = this.near, data.object.far = this.far, data.object.focus = this.focus, data.object.aspect = this.aspect, this.view !== null && (data.object.view = Object.assign({}, this.view)), data.object.filmGauge = this.filmGauge, data.object.filmOffset = this.filmOffset, data;
  }
};
PerspectiveCamera.prototype.isPerspectiveCamera = !0;
var fov = 90, aspect = 1, CubeCamera = class extends Object3D {
  constructor(near, far, renderTarget) {
    super();
    if (this.type = "CubeCamera", renderTarget.isWebGLCubeRenderTarget !== !0) {
      console.error("THREE.CubeCamera: The constructor now expects an instance of WebGLCubeRenderTarget as third parameter.");
      return;
    }
    this.renderTarget = renderTarget;
    let cameraPX = new PerspectiveCamera(fov, aspect, near, far);
    cameraPX.layers = this.layers, cameraPX.up.set(0, -1, 0), cameraPX.lookAt(new Vector3(1, 0, 0)), this.add(cameraPX);
    let cameraNX = new PerspectiveCamera(fov, aspect, near, far);
    cameraNX.layers = this.layers, cameraNX.up.set(0, -1, 0), cameraNX.lookAt(new Vector3(-1, 0, 0)), this.add(cameraNX);
    let cameraPY = new PerspectiveCamera(fov, aspect, near, far);
    cameraPY.layers = this.layers, cameraPY.up.set(0, 0, 1), cameraPY.lookAt(new Vector3(0, 1, 0)), this.add(cameraPY);
    let cameraNY = new PerspectiveCamera(fov, aspect, near, far);
    cameraNY.layers = this.layers, cameraNY.up.set(0, 0, -1), cameraNY.lookAt(new Vector3(0, -1, 0)), this.add(cameraNY);
    let cameraPZ = new PerspectiveCamera(fov, aspect, near, far);
    cameraPZ.layers = this.layers, cameraPZ.up.set(0, -1, 0), cameraPZ.lookAt(new Vector3(0, 0, 1)), this.add(cameraPZ);
    let cameraNZ = new PerspectiveCamera(fov, aspect, near, far);
    cameraNZ.layers = this.layers, cameraNZ.up.set(0, -1, 0), cameraNZ.lookAt(new Vector3(0, 0, -1)), this.add(cameraNZ);
  }
  update(renderer, scene) {
    this.parent === null && this.updateMatrixWorld();
    let renderTarget = this.renderTarget, [cameraPX, cameraNX, cameraPY, cameraNY, cameraPZ, cameraNZ] = this.children, currentXrEnabled = renderer.xr.enabled, currentRenderTarget = renderer.getRenderTarget();
    renderer.xr.enabled = !1;
    let generateMipmaps = renderTarget.texture.generateMipmaps;
    renderTarget.texture.generateMipmaps = !1, renderer.setRenderTarget(renderTarget, 0), renderer.render(scene, cameraPX), renderer.setRenderTarget(renderTarget, 1), renderer.render(scene, cameraNX), renderer.setRenderTarget(renderTarget, 2), renderer.render(scene, cameraPY), renderer.setRenderTarget(renderTarget, 3), renderer.render(scene, cameraNY), renderer.setRenderTarget(renderTarget, 4), renderer.render(scene, cameraPZ), renderTarget.texture.generateMipmaps = generateMipmaps, renderer.setRenderTarget(renderTarget, 5), renderer.render(scene, cameraNZ), renderer.setRenderTarget(currentRenderTarget), renderer.xr.enabled = currentXrEnabled;
  }
}, CubeTexture = class extends Texture {
  constructor(images, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy, encoding) {
    images = images !== void 0 ? images : [], mapping = mapping !== void 0 ? mapping : CubeReflectionMapping, format = format !== void 0 ? format : RGBFormat, super(images, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy, encoding), this._needsFlipEnvMap = !0, this.flipY = !1;
  }
  get images() {
    return this.image;
  }
  set images(value) {
    this.image = value;
  }
};
CubeTexture.prototype.isCubeTexture = !0;
var WebGLCubeRenderTarget = class extends WebGLRenderTarget {
  constructor(size, options, dummy) {
    Number.isInteger(options) && (console.warn("THREE.WebGLCubeRenderTarget: constructor signature is now WebGLCubeRenderTarget( size, options )"), options = dummy), super(size, size, options), options = options || {}, this.texture = new CubeTexture(void 0, options.mapping, options.wrapS, options.wrapT, options.magFilter, options.minFilter, options.format, options.type, options.anisotropy, options.encoding), this.texture.generateMipmaps = options.generateMipmaps !== void 0 ? options.generateMipmaps : !1, this.texture.minFilter = options.minFilter !== void 0 ? options.minFilter : LinearFilter, this.texture._needsFlipEnvMap = !1;
  }
  fromEquirectangularTexture(renderer, texture) {
    this.texture.type = texture.type, this.texture.format = RGBAFormat, this.texture.encoding = texture.encoding, this.texture.generateMipmaps = texture.generateMipmaps, this.texture.minFilter = texture.minFilter, this.texture.magFilter = texture.magFilter;
    let shader = {
      uniforms: {
        tEquirect: { value: null }
      },
      vertexShader: `

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,
      fragmentShader: `

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`
    }, geometry = new BoxGeometry(5, 5, 5), material = new ShaderMaterial({
      name: "CubemapFromEquirect",
      uniforms: cloneUniforms(shader.uniforms),
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
      side: BackSide,
      blending: NoBlending
    });
    material.uniforms.tEquirect.value = texture;
    let mesh = new Mesh(geometry, material), currentMinFilter = texture.minFilter;
    return texture.minFilter === LinearMipmapLinearFilter && (texture.minFilter = LinearFilter), new CubeCamera(1, 10, this).update(renderer, mesh), texture.minFilter = currentMinFilter, mesh.geometry.dispose(), mesh.material.dispose(), this;
  }
  clear(renderer, color, depth, stencil) {
    let currentRenderTarget = renderer.getRenderTarget();
    for (let i = 0; i < 6; i++)
      renderer.setRenderTarget(this, i), renderer.clear(color, depth, stencil);
    renderer.setRenderTarget(currentRenderTarget);
  }
};
WebGLCubeRenderTarget.prototype.isWebGLCubeRenderTarget = !0;
var _sphere$2 = /* @__PURE__ */ new Sphere(), _vector$7 = /* @__PURE__ */ new Vector3(), Frustum = class {
  constructor(p0 = new Plane(), p1 = new Plane(), p2 = new Plane(), p3 = new Plane(), p4 = new Plane(), p5 = new Plane()) {
    this.planes = [p0, p1, p2, p3, p4, p5];
  }
  set(p0, p1, p2, p3, p4, p5) {
    let planes = this.planes;
    return planes[0].copy(p0), planes[1].copy(p1), planes[2].copy(p2), planes[3].copy(p3), planes[4].copy(p4), planes[5].copy(p5), this;
  }
  copy(frustum) {
    let planes = this.planes;
    for (let i = 0; i < 6; i++)
      planes[i].copy(frustum.planes[i]);
    return this;
  }
  setFromProjectionMatrix(m) {
    let planes = this.planes, me = m.elements, me0 = me[0], me1 = me[1], me2 = me[2], me3 = me[3], me4 = me[4], me5 = me[5], me6 = me[6], me7 = me[7], me8 = me[8], me9 = me[9], me10 = me[10], me11 = me[11], me12 = me[12], me13 = me[13], me14 = me[14], me15 = me[15];
    return planes[0].setComponents(me3 - me0, me7 - me4, me11 - me8, me15 - me12).normalize(), planes[1].setComponents(me3 + me0, me7 + me4, me11 + me8, me15 + me12).normalize(), planes[2].setComponents(me3 + me1, me7 + me5, me11 + me9, me15 + me13).normalize(), planes[3].setComponents(me3 - me1, me7 - me5, me11 - me9, me15 - me13).normalize(), planes[4].setComponents(me3 - me2, me7 - me6, me11 - me10, me15 - me14).normalize(), planes[5].setComponents(me3 + me2, me7 + me6, me11 + me10, me15 + me14).normalize(), this;
  }
  intersectsObject(object) {
    let geometry = object.geometry;
    return geometry.boundingSphere === null && geometry.computeBoundingSphere(), _sphere$2.copy(geometry.boundingSphere).applyMatrix4(object.matrixWorld), this.intersectsSphere(_sphere$2);
  }
  intersectsSprite(sprite) {
    return _sphere$2.center.set(0, 0, 0), _sphere$2.radius = 0.7071067811865476, _sphere$2.applyMatrix4(sprite.matrixWorld), this.intersectsSphere(_sphere$2);
  }
  intersectsSphere(sphere) {
    let planes = this.planes, center = sphere.center, negRadius = -sphere.radius;
    for (let i = 0; i < 6; i++)
      if (planes[i].distanceToPoint(center) < negRadius)
        return !1;
    return !0;
  }
  intersectsBox(box) {
    let planes = this.planes;
    for (let i = 0; i < 6; i++) {
      let plane = planes[i];
      if (_vector$7.x = plane.normal.x > 0 ? box.max.x : box.min.x, _vector$7.y = plane.normal.y > 0 ? box.max.y : box.min.y, _vector$7.z = plane.normal.z > 0 ? box.max.z : box.min.z, plane.distanceToPoint(_vector$7) < 0)
        return !1;
    }
    return !0;
  }
  containsPoint(point) {
    let planes = this.planes;
    for (let i = 0; i < 6; i++)
      if (planes[i].distanceToPoint(point) < 0)
        return !1;
    return !0;
  }
  clone() {
    return new this.constructor().copy(this);
  }
};
function WebGLAnimation() {
  let context = null, isAnimating = !1, animationLoop = null, requestId = null;
  function onAnimationFrame(time, frame) {
    animationLoop(time, frame), requestId = context.requestAnimationFrame(onAnimationFrame);
  }
  return {
    start: function() {
      isAnimating !== !0 && animationLoop !== null && (requestId = context.requestAnimationFrame(onAnimationFrame), isAnimating = !0);
    },
    stop: function() {
      context.cancelAnimationFrame(requestId), isAnimating = !1;
    },
    setAnimationLoop: function(callback) {
      animationLoop = callback;
    },
    setContext: function(value) {
      context = value;
    }
  };
}
function WebGLAttributes(gl, capabilities) {
  let isWebGL2 = capabilities.isWebGL2, buffers = new WeakMap();
  function createBuffer(attribute, bufferType) {
    let array = attribute.array, usage = attribute.usage, buffer = gl.createBuffer();
    gl.bindBuffer(bufferType, buffer), gl.bufferData(bufferType, array, usage), attribute.onUploadCallback();
    let type = 5126;
    return array instanceof Float32Array ? type = 5126 : array instanceof Float64Array ? console.warn("THREE.WebGLAttributes: Unsupported data buffer format: Float64Array.") : array instanceof Uint16Array ? attribute.isFloat16BufferAttribute ? isWebGL2 ? type = 5131 : console.warn("THREE.WebGLAttributes: Usage of Float16BufferAttribute requires WebGL2.") : type = 5123 : array instanceof Int16Array ? type = 5122 : array instanceof Uint32Array ? type = 5125 : array instanceof Int32Array ? type = 5124 : array instanceof Int8Array ? type = 5120 : (array instanceof Uint8Array || array instanceof Uint8ClampedArray) && (type = 5121), {
      buffer,
      type,
      bytesPerElement: array.BYTES_PER_ELEMENT,
      version: attribute.version
    };
  }
  function updateBuffer(buffer, attribute, bufferType) {
    let array = attribute.array, updateRange = attribute.updateRange;
    gl.bindBuffer(bufferType, buffer), updateRange.count === -1 ? gl.bufferSubData(bufferType, 0, array) : (isWebGL2 ? gl.bufferSubData(bufferType, updateRange.offset * array.BYTES_PER_ELEMENT, array, updateRange.offset, updateRange.count) : gl.bufferSubData(bufferType, updateRange.offset * array.BYTES_PER_ELEMENT, array.subarray(updateRange.offset, updateRange.offset + updateRange.count)), updateRange.count = -1);
  }
  function get(attribute) {
    return attribute.isInterleavedBufferAttribute && (attribute = attribute.data), buffers.get(attribute);
  }
  function remove(attribute) {
    attribute.isInterleavedBufferAttribute && (attribute = attribute.data);
    let data = buffers.get(attribute);
    data && (gl.deleteBuffer(data.buffer), buffers.delete(attribute));
  }
  function update(attribute, bufferType) {
    if (attribute.isGLBufferAttribute) {
      let cached = buffers.get(attribute);
      (!cached || cached.version < attribute.version) && buffers.set(attribute, {
        buffer: attribute.buffer,
        type: attribute.type,
        bytesPerElement: attribute.elementSize,
        version: attribute.version
      });
      return;
    }
    attribute.isInterleavedBufferAttribute && (attribute = attribute.data);
    let data = buffers.get(attribute);
    data === void 0 ? buffers.set(attribute, createBuffer(attribute, bufferType)) : data.version < attribute.version && (updateBuffer(data.buffer, attribute, bufferType), data.version = attribute.version);
  }
  return {
    get,
    remove,
    update
  };
}
var PlaneGeometry = class extends BufferGeometry {
  constructor(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
    super();
    this.type = "PlaneGeometry", this.parameters = {
      width,
      height,
      widthSegments,
      heightSegments
    };
    let width_half = width / 2, height_half = height / 2, gridX = Math.floor(widthSegments), gridY = Math.floor(heightSegments), gridX1 = gridX + 1, gridY1 = gridY + 1, segment_width = width / gridX, segment_height = height / gridY, indices = [], vertices = [], normals = [], uvs = [];
    for (let iy = 0; iy < gridY1; iy++) {
      let y = iy * segment_height - height_half;
      for (let ix = 0; ix < gridX1; ix++) {
        let x = ix * segment_width - width_half;
        vertices.push(x, -y, 0), normals.push(0, 0, 1), uvs.push(ix / gridX), uvs.push(1 - iy / gridY);
      }
    }
    for (let iy = 0; iy < gridY; iy++)
      for (let ix = 0; ix < gridX; ix++) {
        let a = ix + gridX1 * iy, b = ix + gridX1 * (iy + 1), c = ix + 1 + gridX1 * (iy + 1), d = ix + 1 + gridX1 * iy;
        indices.push(a, b, d), indices.push(b, c, d);
      }
    this.setIndex(indices), this.setAttribute("position", new Float32BufferAttribute(vertices, 3)), this.setAttribute("normal", new Float32BufferAttribute(normals, 3)), this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  }
}, alphamap_fragment = `#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vUv ).g;
#endif`, alphamap_pars_fragment = `#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`, alphatest_fragment = `#ifdef ALPHATEST
	if ( diffuseColor.a < ALPHATEST ) discard;
#endif`, aomap_fragment = `#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vUv2 ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometry.normal, geometry.viewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.specularRoughness );
	#endif
#endif`, aomap_pars_fragment = `#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`, begin_vertex = "vec3 transformed = vec3( position );", beginnormal_vertex = `vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`, bsdfs = `vec2 integrateSpecularBRDF( const in float dotNV, const in float roughness ) {
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	return vec2( -1.04, 1.04 ) * a004 + r.zw;
}
float punctualLightIntensityToIrradianceFactor( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
#if defined ( PHYSICALLY_CORRECT_LIGHTS )
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
#else
	if( cutoffDistance > 0.0 && decayExponent > 0.0 ) {
		return pow( saturate( -lightDistance / cutoffDistance + 1.0 ), decayExponent );
	}
	return 1.0;
#endif
}
vec3 BRDF_Diffuse_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 specularColor, const in float dotLH ) {
	float fresnel = exp2( ( -5.55473 * dotLH - 6.98316 ) * dotLH );
	return ( 1.0 - specularColor ) * fresnel + specularColor;
}
vec3 F_Schlick_RoughnessDependent( const in vec3 F0, const in float dotNV, const in float roughness ) {
	float fresnel = exp2( ( -5.55473 * dotNV - 6.98316 ) * dotNV );
	vec3 Fr = max( vec3( 1.0 - roughness ), F0 ) - F0;
	return Fr * fresnel + F0;
}
float G_GGX_Smith( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gl = dotNL + sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	float gv = dotNV + sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	return 1.0 / ( gl * gv );
}
float G_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
vec3 BRDF_Specular_GGX( const in IncidentLight incidentLight, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float roughness ) {
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( incidentLight.direction + viewDir );
	float dotNL = saturate( dot( normal, incidentLight.direction ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotLH = saturate( dot( incidentLight.direction, halfDir ) );
	vec3 F = F_Schlick( specularColor, dotLH );
	float G = G_GGX_SmithCorrelated( alpha, dotNL, dotNV );
	float D = D_GGX( alpha, dotNH );
	return F * ( G * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
vec3 BRDF_Specular_GGX_Environment( const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 brdf = integrateSpecularBRDF( dotNV, roughness );
	return specularColor * brdf.x + brdf.y;
}
void BRDF_Specular_Multiscattering_Environment( const in GeometricContext geometry, const in vec3 specularColor, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
	float dotNV = saturate( dot( geometry.normal, geometry.viewDir ) );
	vec3 F = F_Schlick_RoughnessDependent( specularColor, dotNV, roughness );
	vec2 brdf = integrateSpecularBRDF( dotNV, roughness );
	vec3 FssEss = F * brdf.x + brdf.y;
	float Ess = brdf.x + brdf.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = specularColor + ( 1.0 - specularColor ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_Specular_BlinnPhong( const in IncidentLight incidentLight, const in GeometricContext geometry, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( incidentLight.direction + geometry.viewDir );
	float dotNH = saturate( dot( geometry.normal, halfDir ) );
	float dotLH = saturate( dot( incidentLight.direction, halfDir ) );
	vec3 F = F_Schlick( specularColor, dotLH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
}
float GGXRoughnessToBlinnExponent( const in float ggxRoughness ) {
	return ( 2.0 / pow2( ggxRoughness + 0.0001 ) - 2.0 );
}
float BlinnExponentToGGXRoughness( const in float blinnExponent ) {
	return sqrt( 2.0 / ( blinnExponent + 2.0 ) );
}
#if defined( USE_SHEEN )
float D_Charlie(float roughness, float NoH) {
	float invAlpha = 1.0 / roughness;
	float cos2h = NoH * NoH;
	float sin2h = max(1.0 - cos2h, 0.0078125);	return (2.0 + invAlpha) * pow(sin2h, invAlpha * 0.5) / (2.0 * PI);
}
float V_Neubelt(float NoV, float NoL) {
	return saturate(1.0 / (4.0 * (NoL + NoV - NoL * NoV)));
}
vec3 BRDF_Specular_Sheen( const in float roughness, const in vec3 L, const in GeometricContext geometry, vec3 specularColor ) {
	vec3 N = geometry.normal;
	vec3 V = geometry.viewDir;
	vec3 H = normalize( V + L );
	float dotNH = saturate( dot( N, H ) );
	return specularColor * D_Charlie( roughness, dotNH ) * V_Neubelt( dot(N, V), dot(N, L) );
}
#endif`, bumpmap_pars_fragment = `#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vUv );
		vec2 dSTdy = dFdy( vUv );
		float Hll = bumpScale * texture2D( bumpMap, vUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = vec3( dFdx( surf_pos.x ), dFdx( surf_pos.y ), dFdx( surf_pos.z ) );
		vec3 vSigmaY = vec3( dFdy( surf_pos.x ), dFdy( surf_pos.y ), dFdy( surf_pos.z ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`, clipping_planes_fragment = `#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#pragma unroll_loop_start
	for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
		plane = clippingPlanes[ i ];
		if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
	}
	#pragma unroll_loop_end
	#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
		bool clipped = true;
		#pragma unroll_loop_start
		for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
		}
		#pragma unroll_loop_end
		if ( clipped ) discard;
	#endif
#endif`, clipping_planes_pars_fragment = `#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`, clipping_planes_pars_vertex = `#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`, clipping_planes_vertex = `#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`, color_fragment = `#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`, color_pars_fragment = `#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`, color_pars_vertex = `#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	varying vec3 vColor;
#endif`, color_vertex = `#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif`, common = `#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate(a) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement(a) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float average( const in vec3 color ) { return dot( color, vec3( 0.3333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract(sin(sn) * c);
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float max3( vec3 v ) { return max( max( v.x, v.y ), v.z ); }
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
struct GeometricContext {
	vec3 position;
	vec3 normal;
	vec3 viewDir;
#ifdef CLEARCOAT
	vec3 clearcoatNormal;
#endif
};
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
vec3 projectOnPlane(in vec3 point, in vec3 pointOnPlane, in vec3 planeNormal ) {
	float distance = dot( planeNormal, point - pointOnPlane );
	return - distance * planeNormal + point;
}
float sideOfPlane( in vec3 point, in vec3 pointOnPlane, in vec3 planeNormal ) {
	return sign( dot( point - pointOnPlane, planeNormal ) );
}
vec3 linePlaneIntersect( in vec3 pointOnLine, in vec3 lineDirection, in vec3 pointOnPlane, in vec3 planeNormal ) {
	return lineDirection * ( dot( planeNormal, pointOnPlane - pointOnLine ) / dot( planeNormal, lineDirection ) ) + pointOnLine;
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
float linearToRelativeLuminance( const in vec3 color ) {
	vec3 weights = vec3( 0.2126, 0.7152, 0.0722 );
	return dot( weights, color.rgb );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}`, cube_uv_reflection_fragment = `#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_maxMipLevel 8.0
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_maxTileSize 256.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		float texelSize = 1.0 / ( 3.0 * cubeUV_maxTileSize );
		vec2 uv = getUV( direction, face ) * ( faceSize - 1.0 );
		vec2 f = fract( uv );
		uv += 0.5 - f;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		if ( mipInt < cubeUV_maxMipLevel ) {
			uv.y += 2.0 * cubeUV_maxTileSize;
		}
		uv.y += filterInt * 2.0 * cubeUV_minTileSize;
		uv.x += 3.0 * max( 0.0, cubeUV_maxTileSize - 2.0 * faceSize );
		uv *= texelSize;
		vec3 tl = envMapTexelToLinear( texture2D( envMap, uv ) ).rgb;
		uv.x += texelSize;
		vec3 tr = envMapTexelToLinear( texture2D( envMap, uv ) ).rgb;
		uv.y += texelSize;
		vec3 br = envMapTexelToLinear( texture2D( envMap, uv ) ).rgb;
		uv.x -= texelSize;
		vec3 bl = envMapTexelToLinear( texture2D( envMap, uv ) ).rgb;
		vec3 tm = mix( tl, tr, f.x );
		vec3 bm = mix( bl, br, f.x );
		return mix( tm, bm, f.y );
	}
	#define r0 1.0
	#define v0 0.339
	#define m0 - 2.0
	#define r1 0.8
	#define v1 0.276
	#define m1 - 1.0
	#define r4 0.4
	#define v4 0.046
	#define m4 2.0
	#define r5 0.305
	#define v5 0.016
	#define m5 3.0
	#define r6 0.21
	#define v6 0.0038
	#define m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= r1 ) {
			mip = ( r0 - roughness ) * ( m1 - m0 ) / ( r0 - r1 ) + m0;
		} else if ( roughness >= r4 ) {
			mip = ( r1 - roughness ) * ( m4 - m1 ) / ( r1 - r4 ) + m1;
		} else if ( roughness >= r5 ) {
			mip = ( r4 - roughness ) * ( m5 - m4 ) / ( r4 - r5 ) + m4;
		} else if ( roughness >= r6 ) {
			mip = ( r5 - roughness ) * ( m6 - m5 ) / ( r5 - r6 ) + m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), m0, cubeUV_maxMipLevel );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`, defaultnormal_vertex = `vec3 transformedNormal = objectNormal;
#ifdef USE_INSTANCING
	mat3 m = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( m[ 0 ], m[ 0 ] ), dot( m[ 1 ], m[ 1 ] ), dot( m[ 2 ], m[ 2 ] ) );
	transformedNormal = m * transformedNormal;
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	vec3 transformedTangent = ( modelViewMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`, displacementmap_pars_vertex = `#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`, displacementmap_vertex = `#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vUv ).x * displacementScale + displacementBias );
#endif`, emissivemap_fragment = `#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vUv );
	emissiveColor.rgb = emissiveMapTexelToLinear( emissiveColor ).rgb;
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`, emissivemap_pars_fragment = `#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`, encodings_fragment = "gl_FragColor = linearToOutputTexel( gl_FragColor );", encodings_pars_fragment = `
vec4 LinearToLinear( in vec4 value ) {
	return value;
}
vec4 GammaToLinear( in vec4 value, in float gammaFactor ) {
	return vec4( pow( value.rgb, vec3( gammaFactor ) ), value.a );
}
vec4 LinearToGamma( in vec4 value, in float gammaFactor ) {
	return vec4( pow( value.rgb, vec3( 1.0 / gammaFactor ) ), value.a );
}
vec4 sRGBToLinear( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 LinearTosRGB( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}
vec4 RGBEToLinear( in vec4 value ) {
	return vec4( value.rgb * exp2( value.a * 255.0 - 128.0 ), 1.0 );
}
vec4 LinearToRGBE( in vec4 value ) {
	float maxComponent = max( max( value.r, value.g ), value.b );
	float fExp = clamp( ceil( log2( maxComponent ) ), -128.0, 127.0 );
	return vec4( value.rgb / exp2( fExp ), ( fExp + 128.0 ) / 255.0 );
}
vec4 RGBMToLinear( in vec4 value, in float maxRange ) {
	return vec4( value.rgb * value.a * maxRange, 1.0 );
}
vec4 LinearToRGBM( in vec4 value, in float maxRange ) {
	float maxRGB = max( value.r, max( value.g, value.b ) );
	float M = clamp( maxRGB / maxRange, 0.0, 1.0 );
	M = ceil( M * 255.0 ) / 255.0;
	return vec4( value.rgb / ( M * maxRange ), M );
}
vec4 RGBDToLinear( in vec4 value, in float maxRange ) {
	return vec4( value.rgb * ( ( maxRange / 255.0 ) / value.a ), 1.0 );
}
vec4 LinearToRGBD( in vec4 value, in float maxRange ) {
	float maxRGB = max( value.r, max( value.g, value.b ) );
	float D = max( maxRange / maxRGB, 1.0 );
	D = clamp( floor( D ) / 255.0, 0.0, 1.0 );
	return vec4( value.rgb * ( D * ( 255.0 / maxRange ) ), D );
}
const mat3 cLogLuvM = mat3( 0.2209, 0.3390, 0.4184, 0.1138, 0.6780, 0.7319, 0.0102, 0.1130, 0.2969 );
vec4 LinearToLogLuv( in vec4 value ) {
	vec3 Xp_Y_XYZp = cLogLuvM * value.rgb;
	Xp_Y_XYZp = max( Xp_Y_XYZp, vec3( 1e-6, 1e-6, 1e-6 ) );
	vec4 vResult;
	vResult.xy = Xp_Y_XYZp.xy / Xp_Y_XYZp.z;
	float Le = 2.0 * log2(Xp_Y_XYZp.y) + 127.0;
	vResult.w = fract( Le );
	vResult.z = ( Le - ( floor( vResult.w * 255.0 ) ) / 255.0 ) / 255.0;
	return vResult;
}
const mat3 cLogLuvInverseM = mat3( 6.0014, -2.7008, -1.7996, -1.3320, 3.1029, -5.7721, 0.3008, -1.0882, 5.6268 );
vec4 LogLuvToLinear( in vec4 value ) {
	float Le = value.z * 255.0 + value.w;
	vec3 Xp_Y_XYZp;
	Xp_Y_XYZp.y = exp2( ( Le - 127.0 ) / 2.0 );
	Xp_Y_XYZp.z = Xp_Y_XYZp.y / value.y;
	Xp_Y_XYZp.x = value.x * Xp_Y_XYZp.z;
	vec3 vRGB = cLogLuvInverseM * Xp_Y_XYZp.rgb;
	return vec4( max( vRGB, 0.0 ), 1.0 );
}`, envmap_fragment = `#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 envColor = textureCubeUV( envMap, reflectVec, 0.0 );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifndef ENVMAP_TYPE_CUBE_UV
		envColor = envMapTexelToLinear( envColor );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`, envmap_common_pars_fragment = `#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform int maxMipLevel;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`, envmap_pars_fragment = `#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`, envmap_pars_vertex = `#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) ||defined( PHONG )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`, envmap_vertex = `#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`, fog_vertex = `#ifdef USE_FOG
	fogDepth = - mvPosition.z;
#endif`, fog_pars_vertex = `#ifdef USE_FOG
	varying float fogDepth;
#endif`, fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDepth * fogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, fogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`, fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float fogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`, gradientmap_pars_fragment = `#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return texture2D( gradientMap, coord ).rgb;
	#else
		return ( coord.x < 0.7 ) ? vec3( 0.7 ) : vec3( 1.0 );
	#endif
}`, lightmap_fragment = `#ifdef USE_LIGHTMAP
	vec4 lightMapTexel= texture2D( lightMap, vUv2 );
	reflectedLight.indirectDiffuse += PI * lightMapTexelToLinear( lightMapTexel ).rgb * lightMapIntensity;
#endif`, lightmap_pars_fragment = `#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`, lights_lambert_vertex = `vec3 diffuse = vec3( 1.0 );
GeometricContext geometry;
geometry.position = mvPosition.xyz;
geometry.normal = normalize( transformedNormal );
geometry.viewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( -mvPosition.xyz );
GeometricContext backGeometry;
backGeometry.position = geometry.position;
backGeometry.normal = -geometry.normal;
backGeometry.viewDir = geometry.viewDir;
vLightFront = vec3( 0.0 );
vIndirectFront = vec3( 0.0 );
#ifdef DOUBLE_SIDED
	vLightBack = vec3( 0.0 );
	vIndirectBack = vec3( 0.0 );
#endif
IncidentLight directLight;
float dotNL;
vec3 directLightColor_Diffuse;
vIndirectFront += getAmbientLightIrradiance( ambientLightColor );
vIndirectFront += getLightProbeIrradiance( lightProbe, geometry );
#ifdef DOUBLE_SIDED
	vIndirectBack += getAmbientLightIrradiance( ambientLightColor );
	vIndirectBack += getLightProbeIrradiance( lightProbe, backGeometry );
#endif
#if NUM_POINT_LIGHTS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		getPointDirectLightIrradiance( pointLights[ i ], geometry, directLight );
		dotNL = dot( geometry.normal, directLight.direction );
		directLightColor_Diffuse = PI * directLight.color;
		vLightFront += saturate( dotNL ) * directLightColor_Diffuse;
		#ifdef DOUBLE_SIDED
			vLightBack += saturate( -dotNL ) * directLightColor_Diffuse;
		#endif
	}
	#pragma unroll_loop_end
#endif
#if NUM_SPOT_LIGHTS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		getSpotDirectLightIrradiance( spotLights[ i ], geometry, directLight );
		dotNL = dot( geometry.normal, directLight.direction );
		directLightColor_Diffuse = PI * directLight.color;
		vLightFront += saturate( dotNL ) * directLightColor_Diffuse;
		#ifdef DOUBLE_SIDED
			vLightBack += saturate( -dotNL ) * directLightColor_Diffuse;
		#endif
	}
	#pragma unroll_loop_end
#endif
#if NUM_DIR_LIGHTS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		getDirectionalDirectLightIrradiance( directionalLights[ i ], geometry, directLight );
		dotNL = dot( geometry.normal, directLight.direction );
		directLightColor_Diffuse = PI * directLight.color;
		vLightFront += saturate( dotNL ) * directLightColor_Diffuse;
		#ifdef DOUBLE_SIDED
			vLightBack += saturate( -dotNL ) * directLightColor_Diffuse;
		#endif
	}
	#pragma unroll_loop_end
#endif
#if NUM_HEMI_LIGHTS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
		vIndirectFront += getHemisphereLightIrradiance( hemisphereLights[ i ], geometry );
		#ifdef DOUBLE_SIDED
			vIndirectBack += getHemisphereLightIrradiance( hemisphereLights[ i ], backGeometry );
		#endif
	}
	#pragma unroll_loop_end
#endif`, lights_pars_begin = `uniform bool receiveShadow;
uniform vec3 ambientLightColor;
uniform vec3 lightProbe[ 9 ];
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in GeometricContext geometry ) {
	vec3 worldNormal = inverseTransformDirection( geometry.normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	#ifndef PHYSICALLY_CORRECT_LIGHTS
		irradiance *= PI;
	#endif
	return irradiance;
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalDirectLightIrradiance( const in DirectionalLight directionalLight, const in GeometricContext geometry, out IncidentLight directLight ) {
		directLight.color = directionalLight.color;
		directLight.direction = directionalLight.direction;
		directLight.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointDirectLightIrradiance( const in PointLight pointLight, const in GeometricContext geometry, out IncidentLight directLight ) {
		vec3 lVector = pointLight.position - geometry.position;
		directLight.direction = normalize( lVector );
		float lightDistance = length( lVector );
		directLight.color = pointLight.color;
		directLight.color *= punctualLightIntensityToIrradianceFactor( lightDistance, pointLight.distance, pointLight.decay );
		directLight.visible = ( directLight.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotDirectLightIrradiance( const in SpotLight spotLight, const in GeometricContext geometry, out IncidentLight directLight ) {
		vec3 lVector = spotLight.position - geometry.position;
		directLight.direction = normalize( lVector );
		float lightDistance = length( lVector );
		float angleCos = dot( directLight.direction, spotLight.direction );
		if ( angleCos > spotLight.coneCos ) {
			float spotEffect = smoothstep( spotLight.coneCos, spotLight.penumbraCos, angleCos );
			directLight.color = spotLight.color;
			directLight.color *= spotEffect * punctualLightIntensityToIrradianceFactor( lightDistance, spotLight.distance, spotLight.decay );
			directLight.visible = true;
		} else {
			directLight.color = vec3( 0.0 );
			directLight.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in GeometricContext geometry ) {
		float dotNL = dot( geometry.normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		#ifndef PHYSICALLY_CORRECT_LIGHTS
			irradiance *= PI;
		#endif
		return irradiance;
	}
#endif`, envmap_physical_pars_fragment = `#if defined( USE_ENVMAP )
	#ifdef ENVMAP_MODE_REFRACTION
		uniform float refractionRatio;
	#endif
	vec3 getLightProbeIndirectIrradiance( const in GeometricContext geometry, const in int maxMIPLevel ) {
		vec3 worldNormal = inverseTransformDirection( geometry.normal, viewMatrix );
		#ifdef ENVMAP_TYPE_CUBE
			vec3 queryVec = vec3( flipEnvMap * worldNormal.x, worldNormal.yz );
			#ifdef TEXTURE_LOD_EXT
				vec4 envMapColor = textureCubeLodEXT( envMap, queryVec, float( maxMIPLevel ) );
			#else
				vec4 envMapColor = textureCube( envMap, queryVec, float( maxMIPLevel ) );
			#endif
			envMapColor.rgb = envMapTexelToLinear( envMapColor ).rgb;
		#elif defined( ENVMAP_TYPE_CUBE_UV )
			vec4 envMapColor = textureCubeUV( envMap, worldNormal, 1.0 );
		#else
			vec4 envMapColor = vec4( 0.0 );
		#endif
		return PI * envMapColor.rgb * envMapIntensity;
	}
	float getSpecularMIPLevel( const in float roughness, const in int maxMIPLevel ) {
		float maxMIPLevelScalar = float( maxMIPLevel );
		float sigma = PI * roughness * roughness / ( 1.0 + roughness );
		float desiredMIPLevel = maxMIPLevelScalar + log2( sigma );
		return clamp( desiredMIPLevel, 0.0, maxMIPLevelScalar );
	}
	vec3 getLightProbeIndirectRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in int maxMIPLevel ) {
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( -viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
		#else
			vec3 reflectVec = refract( -viewDir, normal, refractionRatio );
		#endif
		reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
		float specularMIPLevel = getSpecularMIPLevel( roughness, maxMIPLevel );
		#ifdef ENVMAP_TYPE_CUBE
			vec3 queryReflectVec = vec3( flipEnvMap * reflectVec.x, reflectVec.yz );
			#ifdef TEXTURE_LOD_EXT
				vec4 envMapColor = textureCubeLodEXT( envMap, queryReflectVec, specularMIPLevel );
			#else
				vec4 envMapColor = textureCube( envMap, queryReflectVec, specularMIPLevel );
			#endif
			envMapColor.rgb = envMapTexelToLinear( envMapColor ).rgb;
		#elif defined( ENVMAP_TYPE_CUBE_UV )
			vec4 envMapColor = textureCubeUV( envMap, reflectVec, roughness );
		#endif
		return envMapColor.rgb * envMapIntensity;
	}
#endif`, lights_toon_fragment = `ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`, lights_toon_pars_fragment = `varying vec3 vViewPosition;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in GeometricContext geometry, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometry.normal, directLight.direction ) * directLight.color;
	#ifndef PHYSICALLY_CORRECT_LIGHTS
		irradiance *= PI;
	#endif
	reflectedLight.directDiffuse += irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in GeometricContext geometry, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon
#define Material_LightProbeLOD( material )	(0)`, lights_phong_fragment = `BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`, lights_phong_pars_fragment = `varying vec3 vViewPosition;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in GeometricContext geometry, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometry.normal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifndef PHYSICALLY_CORRECT_LIGHTS
		irradiance *= PI;
	#endif
	reflectedLight.directDiffuse += irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_Specular_BlinnPhong( directLight, geometry, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in GeometricContext geometry, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong
#define Material_LightProbeLOD( material )	(0)`, lights_physical_fragment = `PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( geometryNormal ) ), abs( dFdy( geometryNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.specularRoughness = max( roughnessFactor, 0.0525 );material.specularRoughness += geometryRoughness;
material.specularRoughness = min( material.specularRoughness, 1.0 );
#ifdef REFLECTIVITY
	material.specularColor = mix( vec3( MAXIMUM_SPECULAR_COEFFICIENT * pow2( reflectivity ) ), rawDiffuseColor, metalnessFactor );
#else
	material.specularColor = mix( vec3( DEFAULT_SPECULAR_COEFFICIENT ), rawDiffuseColor, metalnessFactor );
#endif
#ifdef CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheen;
#endif`, lights_physical_pars_fragment = `struct PhysicalMaterial {
	vec3 diffuseColor;
	float specularRoughness;
	vec3 specularColor;
#ifdef CLEARCOAT
	float clearcoat;
	float clearcoatRoughness;
#endif
#ifdef USE_SHEEN
	vec3 sheenColor;
#endif
};
#define MAXIMUM_SPECULAR_COEFFICIENT 0.16
#define DEFAULT_SPECULAR_COEFFICIENT 0.04
float clearcoatDHRApprox( const in float roughness, const in float dotNL ) {
	return DEFAULT_SPECULAR_COEFFICIENT + ( 1.0 - DEFAULT_SPECULAR_COEFFICIENT ) * ( pow( 1.0 - dotNL, 5.0 ) * pow( 1.0 - roughness, 2.0 ) );
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in GeometricContext geometry, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometry.normal;
		vec3 viewDir = geometry.viewDir;
		vec3 position = geometry.position;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.specularRoughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in GeometricContext geometry, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometry.normal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifndef PHYSICALLY_CORRECT_LIGHTS
		irradiance *= PI;
	#endif
	#ifdef CLEARCOAT
		float ccDotNL = saturate( dot( geometry.clearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = ccDotNL * directLight.color;
		#ifndef PHYSICALLY_CORRECT_LIGHTS
			ccIrradiance *= PI;
		#endif
		float clearcoatDHR = material.clearcoat * clearcoatDHRApprox( material.clearcoatRoughness, ccDotNL );
		reflectedLight.directSpecular += ccIrradiance * material.clearcoat * BRDF_Specular_GGX( directLight, geometry.viewDir, geometry.clearcoatNormal, vec3( DEFAULT_SPECULAR_COEFFICIENT ), material.clearcoatRoughness );
	#else
		float clearcoatDHR = 0.0;
	#endif
	#ifdef USE_SHEEN
		reflectedLight.directSpecular += ( 1.0 - clearcoatDHR ) * irradiance * BRDF_Specular_Sheen(
			material.specularRoughness,
			directLight.direction,
			geometry,
			material.sheenColor
		);
	#else
		reflectedLight.directSpecular += ( 1.0 - clearcoatDHR ) * irradiance * BRDF_Specular_GGX( directLight, geometry.viewDir, geometry.normal, material.specularColor, material.specularRoughness);
	#endif
	reflectedLight.directDiffuse += ( 1.0 - clearcoatDHR ) * irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in GeometricContext geometry, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in GeometricContext geometry, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef CLEARCOAT
		float ccDotNV = saturate( dot( geometry.clearcoatNormal, geometry.viewDir ) );
		reflectedLight.indirectSpecular += clearcoatRadiance * material.clearcoat * BRDF_Specular_GGX_Environment( geometry.viewDir, geometry.clearcoatNormal, vec3( DEFAULT_SPECULAR_COEFFICIENT ), material.clearcoatRoughness );
		float ccDotNL = ccDotNV;
		float clearcoatDHR = material.clearcoat * clearcoatDHRApprox( material.clearcoatRoughness, ccDotNL );
	#else
		float clearcoatDHR = 0.0;
	#endif
	float clearcoatInv = 1.0 - clearcoatDHR;
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	BRDF_Specular_Multiscattering_Environment( geometry, material.specularColor, material.specularRoughness, singleScattering, multiScattering );
	vec3 diffuse = material.diffuseColor * ( 1.0 - ( singleScattering + multiScattering ) );
	reflectedLight.indirectSpecular += clearcoatInv * radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`, lights_fragment_begin = `
GeometricContext geometry;
geometry.position = - vViewPosition;
geometry.normal = normal;
geometry.viewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
#ifdef CLEARCOAT
	geometry.clearcoatNormal = clearcoatNormal;
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointDirectLightIrradiance( pointLight, geometry, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= all( bvec2( directLight.visible, receiveShadow ) ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometry, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotDirectLightIrradiance( spotLight, geometry, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometry, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalDirectLightIrradiance( directionalLight, geometry, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometry, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometry, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	irradiance += getLightProbeIrradiance( lightProbe, geometry );
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometry );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`, lights_fragment_maps = `#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel= texture2D( lightMap, vUv2 );
		vec3 lightMapIrradiance = lightMapTexelToLinear( lightMapTexel ).rgb * lightMapIntensity;
		#ifndef PHYSICALLY_CORRECT_LIGHTS
			lightMapIrradiance *= PI;
		#endif
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getLightProbeIndirectIrradiance( geometry, maxMipLevel );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	radiance += getLightProbeIndirectRadiance( geometry.viewDir, geometry.normal, material.specularRoughness, maxMipLevel );
	#ifdef CLEARCOAT
		clearcoatRadiance += getLightProbeIndirectRadiance( geometry.viewDir, geometry.clearcoatNormal, material.clearcoatRoughness, maxMipLevel );
	#endif
#endif`, lights_fragment_end = `#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometry, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometry, material, reflectedLight );
#endif`, logdepthbuf_fragment = `#if defined( USE_LOGDEPTHBUF ) && defined( USE_LOGDEPTHBUF_EXT )
	gl_FragDepthEXT = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`, logdepthbuf_pars_fragment = `#if defined( USE_LOGDEPTHBUF ) && defined( USE_LOGDEPTHBUF_EXT )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`, logdepthbuf_pars_vertex = `#ifdef USE_LOGDEPTHBUF
	#ifdef USE_LOGDEPTHBUF_EXT
		varying float vFragDepth;
		varying float vIsPerspective;
	#else
		uniform float logDepthBufFC;
	#endif
#endif`, logdepthbuf_vertex = `#ifdef USE_LOGDEPTHBUF
	#ifdef USE_LOGDEPTHBUF_EXT
		vFragDepth = 1.0 + gl_Position.w;
		vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
	#else
		if ( isPerspectiveMatrix( projectionMatrix ) ) {
			gl_Position.z = log2( max( EPSILON, gl_Position.w + 1.0 ) ) * logDepthBufFC - 1.0;
			gl_Position.z *= gl_Position.w;
		}
	#endif
#endif`, map_fragment = `#ifdef USE_MAP
	vec4 texelColor = texture2D( map, vUv );
	texelColor = mapTexelToLinear( texelColor );
	diffuseColor *= texelColor;
#endif`, map_pars_fragment = `#ifdef USE_MAP
	uniform sampler2D map;
#endif`, map_particle_fragment = `#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
#endif
#ifdef USE_MAP
	vec4 mapTexel = texture2D( map, uv );
	diffuseColor *= mapTexelToLinear( mapTexel );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`, map_particle_pars_fragment = `#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	uniform mat3 uvTransform;
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`, metalnessmap_fragment = `float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vUv );
	metalnessFactor *= texelMetalness.b;
#endif`, metalnessmap_pars_fragment = `#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`, morphnormal_vertex = `#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	objectNormal += morphNormal0 * morphTargetInfluences[ 0 ];
	objectNormal += morphNormal1 * morphTargetInfluences[ 1 ];
	objectNormal += morphNormal2 * morphTargetInfluences[ 2 ];
	objectNormal += morphNormal3 * morphTargetInfluences[ 3 ];
#endif`, morphtarget_pars_vertex = `#ifdef USE_MORPHTARGETS
	uniform float morphTargetBaseInfluence;
	#ifndef USE_MORPHNORMALS
		uniform float morphTargetInfluences[ 8 ];
	#else
		uniform float morphTargetInfluences[ 4 ];
	#endif
#endif`, morphtarget_vertex = `#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	transformed += morphTarget0 * morphTargetInfluences[ 0 ];
	transformed += morphTarget1 * morphTargetInfluences[ 1 ];
	transformed += morphTarget2 * morphTargetInfluences[ 2 ];
	transformed += morphTarget3 * morphTargetInfluences[ 3 ];
	#ifndef USE_MORPHNORMALS
		transformed += morphTarget4 * morphTargetInfluences[ 4 ];
		transformed += morphTarget5 * morphTargetInfluences[ 5 ];
		transformed += morphTarget6 * morphTargetInfluences[ 6 ];
		transformed += morphTarget7 * morphTargetInfluences[ 7 ];
	#endif
#endif`, normal_fragment_begin = `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = vec3( dFdx( vViewPosition.x ), dFdx( vViewPosition.y ), dFdx( vViewPosition.z ) );
	vec3 fdy = vec3( dFdy( vViewPosition.x ), dFdy( vViewPosition.y ), dFdy( vViewPosition.z ) );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	#ifdef USE_TANGENT
		vec3 tangent = normalize( vTangent );
		vec3 bitangent = normalize( vBitangent );
		#ifdef DOUBLE_SIDED
			tangent = tangent * faceDirection;
			bitangent = bitangent * faceDirection;
		#endif
		#if defined( TANGENTSPACE_NORMALMAP ) || defined( USE_CLEARCOAT_NORMALMAP )
			mat3 vTBN = mat3( tangent, bitangent, normal );
		#endif
	#endif
#endif
vec3 geometryNormal = normal;`, normal_fragment_maps = `#ifdef OBJECTSPACE_NORMALMAP
	normal = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( TANGENTSPACE_NORMALMAP )
	vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	#ifdef USE_TANGENT
		normal = normalize( vTBN * mapN );
	#else
		normal = perturbNormal2Arb( -vViewPosition, normal, mapN, faceDirection );
	#endif
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( -vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`, normalmap_pars_fragment = `#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef OBJECTSPACE_NORMALMAP
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( TANGENTSPACE_NORMALMAP ) || defined ( USE_CLEARCOAT_NORMALMAP ) )
	vec3 perturbNormal2Arb( vec3 eye_pos, vec3 surf_norm, vec3 mapN, float faceDirection ) {
		vec3 q0 = vec3( dFdx( eye_pos.x ), dFdx( eye_pos.y ), dFdx( eye_pos.z ) );
		vec3 q1 = vec3( dFdy( eye_pos.x ), dFdy( eye_pos.y ), dFdy( eye_pos.z ) );
		vec2 st0 = dFdx( vUv.st );
		vec2 st1 = dFdy( vUv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : faceDirection * inversesqrt( det );
		return normalize( T * ( mapN.x * scale ) + B * ( mapN.y * scale ) + N * mapN.z );
	}
#endif`, clearcoat_normal_fragment_begin = `#ifdef CLEARCOAT
	vec3 clearcoatNormal = geometryNormal;
#endif`, clearcoat_normal_fragment_maps = `#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	#ifdef USE_TANGENT
		clearcoatNormal = normalize( vTBN * clearcoatMapN );
	#else
		clearcoatNormal = perturbNormal2Arb( - vViewPosition, clearcoatNormal, clearcoatMapN, faceDirection );
	#endif
#endif`, clearcoat_pars_fragment = `#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif`, packing = `vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;
const vec3 PackFactors = vec3( 256. * 256. * 256., 256. * 256., 256. );
const vec4 UnpackFactors = UnpackDownscale / vec4( PackFactors, 1. );
const float ShiftRight8 = 1. / 256.;
vec4 packDepthToRGBA( const in float v ) {
	vec4 r = vec4( fract( v * PackFactors ), v );
	r.yzw -= r.xyz * ShiftRight8;	return r * PackUpscale;
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors );
}
vec4 pack2HalfToRGBA( vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ));
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w);
}
vec2 unpackRGBATo2Half( vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float linearClipZ, const in float near, const in float far ) {
	return linearClipZ * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return (( near + viewZ ) * far ) / (( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float invClipZ, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * invClipZ - far );
}`, premultiplied_alpha_fragment = `#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`, project_vertex = `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`, dithering_fragment = `#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`, dithering_pars_fragment = `#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`, roughnessmap_fragment = `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vUv );
	roughnessFactor *= texelRoughness.g;
#endif`, roughnessmap_pars_fragment = `#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`, shadowmap_pars_fragment = `#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		varying vec4 vSpotShadowCoord[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bvec4 inFrustumVec = bvec4 ( shadowCoord.x >= 0.0, shadowCoord.x <= 1.0, shadowCoord.y >= 0.0, shadowCoord.y <= 1.0 );
		bool inFrustum = all( inFrustumVec );
		bvec2 frustumTestVec = bvec2( inFrustum, shadowCoord.z <= 1.0 );
		bool frustumTest = all( frustumTestVec );
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ), 
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ), 
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ), 
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ), 
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ), 
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ), 
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return shadow;
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
		vec3 lightToPosition = shadowCoord.xyz;
		float dp = ( length( lightToPosition ) - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );		dp += shadowBias;
		vec3 bd3D = normalize( lightToPosition );
		#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
			vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
			return (
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
			) * ( 1.0 / 9.0 );
		#else
			return texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
		#endif
	}
#endif`, shadowmap_pars_vertex = `#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform mat4 spotShadowMatrix[ NUM_SPOT_LIGHT_SHADOWS ];
		varying vec4 vSpotShadowCoord[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`, shadowmap_vertex = `#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0 || NUM_SPOT_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0
		vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		vec4 shadowWorldPosition;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
		vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias, 0 );
		vSpotShadowCoord[ i ] = spotShadowMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
		vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
	#endif
#endif`, shadowmask_pars_fragment = `float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowBias, spotLight.shadowRadius, vSpotShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`, skinbase_vertex = `#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`, skinning_pars_vertex = `#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	#ifdef BONE_TEXTURE
		uniform highp sampler2D boneTexture;
		uniform int boneTextureSize;
		mat4 getBoneMatrix( const in float i ) {
			float j = i * 4.0;
			float x = mod( j, float( boneTextureSize ) );
			float y = floor( j / float( boneTextureSize ) );
			float dx = 1.0 / float( boneTextureSize );
			float dy = 1.0 / float( boneTextureSize );
			y = dy * ( y + 0.5 );
			vec4 v1 = texture2D( boneTexture, vec2( dx * ( x + 0.5 ), y ) );
			vec4 v2 = texture2D( boneTexture, vec2( dx * ( x + 1.5 ), y ) );
			vec4 v3 = texture2D( boneTexture, vec2( dx * ( x + 2.5 ), y ) );
			vec4 v4 = texture2D( boneTexture, vec2( dx * ( x + 3.5 ), y ) );
			mat4 bone = mat4( v1, v2, v3, v4 );
			return bone;
		}
	#else
		uniform mat4 boneMatrices[ MAX_BONES ];
		mat4 getBoneMatrix( const in float i ) {
			mat4 bone = boneMatrices[ int(i) ];
			return bone;
		}
	#endif
#endif`, skinning_vertex = `#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`, skinnormal_vertex = `#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`, specularmap_fragment = `float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`, specularmap_pars_fragment = `#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`, tonemapping_fragment = `#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`, tonemapping_pars_fragment = `#ifndef saturate
#define saturate(a) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return toneMappingExposure * color;
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 OptimizedCineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`, transmission_fragment = `#ifdef USE_TRANSMISSION
	#ifdef USE_TRANSMISSIONMAP
		totalTransmission *= texture2D( transmissionMap, vUv ).r;
	#endif
	#ifdef USE_THICKNESSNMAP
		thicknessFactor *= texture2D( thicknessMap, vUv ).g;
	#endif
	vec3 pos = vWorldPosition.xyz / vWorldPosition.w;
	vec3 v = normalize( cameraPosition - pos );
	vec3 viewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
	float ior = ( 1.0 + 0.4 * reflectivity ) / ( 1.0 - 0.4 * reflectivity );
	vec3 f0 = vec3( pow( ior - 1.0, 2.0 ) / pow( ior + 1.0, 2.0 ) );
	vec3 f90 = vec3( 1.0 );
	vec3 f_transmission = totalTransmission * getIBLVolumeRefraction(
		normal, v, viewDir, roughnessFactor, diffuseColor.rgb, f0, f90,
		pos, modelMatrix, viewMatrix, projectionMatrix, ior, thicknessFactor,
		attenuationColor, attenuationDistance);
	diffuseColor.rgb = mix( diffuseColor.rgb, f_transmission, totalTransmission );
#endif`, transmission_pars_fragment = `#ifdef USE_TRANSMISSION
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec4 vWorldPosition;
	vec3 getVolumeTransmissionRay(vec3 n, vec3 v, float thickness, float ior, mat4 modelMatrix) {
		vec3 refractionVector = refract(-v, normalize(n), 1.0 / ior);
		vec3 modelScale;
		modelScale.x = length(vec3(modelMatrix[0].xyz));
		modelScale.y = length(vec3(modelMatrix[1].xyz));
		modelScale.z = length(vec3(modelMatrix[2].xyz));
		return normalize(refractionVector) * thickness * modelScale;
	}
	float applyIorToRoughness(float roughness, float ior) {
		return roughness * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
	}
	vec3 getTransmissionSample(vec2 fragCoord, float roughness, float ior) {
		float framebufferLod = log2(transmissionSamplerSize.x) * applyIorToRoughness(roughness, ior);
		return texture2DLodEXT(transmissionSamplerMap, fragCoord.xy, framebufferLod).rgb;
	}
	vec3 applyVolumeAttenuation(vec3 radiance, float transmissionDistance, vec3 attenuationColor, float attenuationDistance) {
		if (attenuationDistance == 0.0) {
			return radiance;
		} else {
			vec3 attenuationCoefficient = -log(attenuationColor) / attenuationDistance;
			vec3 transmittance = exp(-attenuationCoefficient * transmissionDistance);			return transmittance * radiance;
		}
	}
	vec3 getIBLVolumeRefraction(vec3 n, vec3 v, vec3 viewDir, float perceptualRoughness, vec3 baseColor, vec3 f0, vec3 f90,
		vec3 position, mat4 modelMatrix, mat4 viewMatrix, mat4 projMatrix, float ior, float thickness, vec3 attenuationColor, float attenuationDistance) {
		vec3 transmissionRay = getVolumeTransmissionRay(n, v, thickness, ior, modelMatrix);
		vec3 refractedRayExit = position + transmissionRay;
		vec4 ndcPos = projMatrix * viewMatrix * vec4(refractedRayExit, 1.0);
		vec2 refractionCoords = ndcPos.xy / ndcPos.w;
		refractionCoords += 1.0;
		refractionCoords /= 2.0;
		vec3 transmittedLight = getTransmissionSample(refractionCoords, perceptualRoughness, ior);
		vec3 attenuatedColor = applyVolumeAttenuation(transmittedLight, length(transmissionRay), attenuationColor, attenuationDistance);
		float NdotV = saturate(dot(n, viewDir));
		vec2 brdf = integrateSpecularBRDF(NdotV, perceptualRoughness);
		vec3 specularColor = f0 * brdf.x + f90 * brdf.y;
		return (1.0 - specularColor) * attenuatedColor * baseColor;
	}
#endif`, uv_pars_fragment = `#if ( defined( USE_UV ) && ! defined( UVS_VERTEX_ONLY ) )
	varying vec2 vUv;
#endif`, uv_pars_vertex = `#ifdef USE_UV
	#ifdef UVS_VERTEX_ONLY
		vec2 vUv;
	#else
		varying vec2 vUv;
	#endif
	uniform mat3 uvTransform;
#endif`, uv_vertex = `#ifdef USE_UV
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
#endif`, uv2_pars_fragment = `#if defined( USE_LIGHTMAP ) || defined( USE_AOMAP )
	varying vec2 vUv2;
#endif`, uv2_pars_vertex = `#if defined( USE_LIGHTMAP ) || defined( USE_AOMAP )
	attribute vec2 uv2;
	varying vec2 vUv2;
	uniform mat3 uv2Transform;
#endif`, uv2_vertex = `#if defined( USE_LIGHTMAP ) || defined( USE_AOMAP )
	vUv2 = ( uv2Transform * vec3( uv2, 1 ) ).xy;
#endif`, worldpos_vertex = `#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION )
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`, background_frag = `uniform sampler2D t2D;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	gl_FragColor = mapTexelToLinear( texColor );
	#include <tonemapping_fragment>
	#include <encodings_fragment>
}`, background_vert = `varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`, cube_frag = `#include <envmap_common_pars_fragment>
uniform float opacity;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	vec3 vReflect = vWorldDirection;
	#include <envmap_fragment>
	gl_FragColor = envColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <encodings_fragment>
}`, cube_vert = `varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`, depth_frag = `#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( 1.0 );
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#endif
}`, depth_vert = `#include <common>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <skinbase_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`, distanceRGBA_frag = `#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( 1.0 );
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`, distanceRGBA_vert = `#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <skinbase_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`, equirect_frag = `uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	vec4 texColor = texture2D( tEquirect, sampleUV );
	gl_FragColor = mapTexelToLinear( texColor );
	#include <tonemapping_fragment>
	#include <encodings_fragment>
}`, equirect_vert = `varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`, linedashed_frag = `uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	gl_FragColor = vec4( outgoingLight, diffuseColor.a );
	#include <tonemapping_fragment>
	#include <encodings_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`, linedashed_vert = `uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <color_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`, meshbasic_frag = `uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <uv2_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
	
		vec4 lightMapTexel= texture2D( lightMap, vUv2 );
		reflectedLight.indirectDiffuse += lightMapTexelToLinear( lightMapTexel ).rgb * lightMapIntensity;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	gl_FragColor = vec4( outgoingLight, diffuseColor.a );
	#include <tonemapping_fragment>
	#include <encodings_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`, meshbasic_vert = `#include <common>
#include <uv_pars_vertex>
#include <uv2_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <uv2_vertex>
	#include <color_vertex>
	#include <skinbase_vertex>
	#ifdef USE_ENVMAP
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`, meshlambert_frag = `uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
varying vec3 vLightFront;
varying vec3 vIndirectFront;
#ifdef DOUBLE_SIDED
	varying vec3 vLightBack;
	varying vec3 vIndirectBack;
#endif
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <uv2_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <fog_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <specularmap_fragment>
	#include <emissivemap_fragment>
	#ifdef DOUBLE_SIDED
		reflectedLight.indirectDiffuse += ( gl_FrontFacing ) ? vIndirectFront : vIndirectBack;
	#else
		reflectedLight.indirectDiffuse += vIndirectFront;
	#endif
	#include <lightmap_fragment>
	reflectedLight.indirectDiffuse *= BRDF_Diffuse_Lambert( diffuseColor.rgb );
	#ifdef DOUBLE_SIDED
		reflectedLight.directDiffuse = ( gl_FrontFacing ) ? vLightFront : vLightBack;
	#else
		reflectedLight.directDiffuse = vLightFront;
	#endif
	reflectedLight.directDiffuse *= BRDF_Diffuse_Lambert( diffuseColor.rgb ) * getShadowMask();
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	gl_FragColor = vec4( outgoingLight, diffuseColor.a );
	#include <tonemapping_fragment>
	#include <encodings_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`, meshlambert_vert = `#define LAMBERT
varying vec3 vLightFront;
varying vec3 vIndirectFront;
#ifdef DOUBLE_SIDED
	varying vec3 vLightBack;
	varying vec3 vIndirectBack;
#endif
#include <common>
#include <uv_pars_vertex>
#include <uv2_pars_vertex>
#include <envmap_pars_vertex>
#include <bsdfs>
#include <lights_pars_begin>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <uv2_vertex>
	#include <color_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <lights_lambert_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`, meshmatcap_frag = `#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <fog_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
		matcapColor = matcapTexelToLinear( matcapColor );
	#else
		vec4 matcapColor = vec4( 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	gl_FragColor = vec4( outgoingLight, diffuseColor.a );
	#include <tonemapping_fragment>
	#include <encodings_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`, meshmatcap_vert = `#define MATCAP
varying vec3 vViewPosition;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#ifndef FLAT_SHADED
		vNormal = normalize( transformedNormal );
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`, meshtoon_frag = `#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <uv2_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	gl_FragColor = vec4( outgoingLight, diffuseColor.a );
	#include <tonemapping_fragment>
	#include <encodings_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`, meshtoon_vert = `#define TOON
varying vec3 vViewPosition;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <uv_pars_vertex>
#include <uv2_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <uv2_vertex>
	#include <color_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`, meshphong_frag = `#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <uv2_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	gl_FragColor = vec4( outgoingLight, diffuseColor.a );
	#include <tonemapping_fragment>
	#include <encodings_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`, meshphong_vert = `#define PHONG
varying vec3 vViewPosition;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <uv_pars_vertex>
#include <uv2_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <uv2_vertex>
	#include <color_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`, meshphysical_frag = `#define STANDARD
#ifdef PHYSICAL
	#define REFLECTIVITY
	#define CLEARCOAT
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform vec3 attenuationColor;
	uniform float attenuationDistance;
#endif
#ifdef REFLECTIVITY
	uniform float reflectivity;
#endif
#ifdef CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheen;
#endif
varying vec3 vViewPosition;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <uv2_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <bsdfs>
#include <transmission_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <lights_physical_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#ifdef USE_TRANSMISSION
		float totalTransmission = transmission;
		float thicknessFactor = thickness;
	#endif
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	vec3 rawDiffuseColor = diffuseColor.rgb;
	#include <transmission_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	gl_FragColor = vec4( outgoingLight, diffuseColor.a );
	#include <tonemapping_fragment>
	#include <encodings_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`, meshphysical_vert = `#define STANDARD
varying vec3 vViewPosition;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif
#ifdef USE_TRANSMISSION
	varying vec4 vWorldPosition;
#endif
#include <common>
#include <uv_pars_vertex>
#include <uv2_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <uv2_vertex>
	#include <color_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition;
#endif
}`, normal_frag = `#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( TANGENTSPACE_NORMALMAP )
	varying vec3 vViewPosition;
#endif
#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif
#include <packing>
#include <uv_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), opacity );
}`, normal_vert = `#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( TANGENTSPACE_NORMALMAP )
	varying vec3 vViewPosition;
#endif
#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif
#include <common>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( TANGENTSPACE_NORMALMAP )
	vViewPosition = - mvPosition.xyz;
#endif
}`, points_frag = `uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	outgoingLight = diffuseColor.rgb;
	gl_FragColor = vec4( outgoingLight, diffuseColor.a );
	#include <tonemapping_fragment>
	#include <encodings_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`, points_vert = `uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <color_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`, shadow_frag = `uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <encodings_fragment>
	#include <fog_fragment>
}`, shadow_vert = `#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <begin_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`, sprite_frag = `uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	outgoingLight = diffuseColor.rgb;
	gl_FragColor = vec4( outgoingLight, diffuseColor.a );
	#include <tonemapping_fragment>
	#include <encodings_fragment>
	#include <fog_fragment>
}`, sprite_vert = `uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
	vec2 scale;
	scale.x = length( vec3( modelMatrix[ 0 ].x, modelMatrix[ 0 ].y, modelMatrix[ 0 ].z ) );
	scale.y = length( vec3( modelMatrix[ 1 ].x, modelMatrix[ 1 ].y, modelMatrix[ 1 ].z ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`, ShaderChunk = {
  alphamap_fragment,
  alphamap_pars_fragment,
  alphatest_fragment,
  aomap_fragment,
  aomap_pars_fragment,
  begin_vertex,
  beginnormal_vertex,
  bsdfs,
  bumpmap_pars_fragment,
  clipping_planes_fragment,
  clipping_planes_pars_fragment,
  clipping_planes_pars_vertex,
  clipping_planes_vertex,
  color_fragment,
  color_pars_fragment,
  color_pars_vertex,
  color_vertex,
  common,
  cube_uv_reflection_fragment,
  defaultnormal_vertex,
  displacementmap_pars_vertex,
  displacementmap_vertex,
  emissivemap_fragment,
  emissivemap_pars_fragment,
  encodings_fragment,
  encodings_pars_fragment,
  envmap_fragment,
  envmap_common_pars_fragment,
  envmap_pars_fragment,
  envmap_pars_vertex,
  envmap_physical_pars_fragment,
  envmap_vertex,
  fog_vertex,
  fog_pars_vertex,
  fog_fragment,
  fog_pars_fragment,
  gradientmap_pars_fragment,
  lightmap_fragment,
  lightmap_pars_fragment,
  lights_lambert_vertex,
  lights_pars_begin,
  lights_toon_fragment,
  lights_toon_pars_fragment,
  lights_phong_fragment,
  lights_phong_pars_fragment,
  lights_physical_fragment,
  lights_physical_pars_fragment,
  lights_fragment_begin,
  lights_fragment_maps,
  lights_fragment_end,
  logdepthbuf_fragment,
  logdepthbuf_pars_fragment,
  logdepthbuf_pars_vertex,
  logdepthbuf_vertex,
  map_fragment,
  map_pars_fragment,
  map_particle_fragment,
  map_particle_pars_fragment,
  metalnessmap_fragment,
  metalnessmap_pars_fragment,
  morphnormal_vertex,
  morphtarget_pars_vertex,
  morphtarget_vertex,
  normal_fragment_begin,
  normal_fragment_maps,
  normalmap_pars_fragment,
  clearcoat_normal_fragment_begin,
  clearcoat_normal_fragment_maps,
  clearcoat_pars_fragment,
  packing,
  premultiplied_alpha_fragment,
  project_vertex,
  dithering_fragment,
  dithering_pars_fragment,
  roughnessmap_fragment,
  roughnessmap_pars_fragment,
  shadowmap_pars_fragment,
  shadowmap_pars_vertex,
  shadowmap_vertex,
  shadowmask_pars_fragment,
  skinbase_vertex,
  skinning_pars_vertex,
  skinning_vertex,
  skinnormal_vertex,
  specularmap_fragment,
  specularmap_pars_fragment,
  tonemapping_fragment,
  tonemapping_pars_fragment,
  transmission_fragment,
  transmission_pars_fragment,
  uv_pars_fragment,
  uv_pars_vertex,
  uv_vertex,
  uv2_pars_fragment,
  uv2_pars_vertex,
  uv2_vertex,
  worldpos_vertex,
  background_frag,
  background_vert,
  cube_frag,
  cube_vert,
  depth_frag,
  depth_vert,
  distanceRGBA_frag,
  distanceRGBA_vert,
  equirect_frag,
  equirect_vert,
  linedashed_frag,
  linedashed_vert,
  meshbasic_frag,
  meshbasic_vert,
  meshlambert_frag,
  meshlambert_vert,
  meshmatcap_frag,
  meshmatcap_vert,
  meshtoon_frag,
  meshtoon_vert,
  meshphong_frag,
  meshphong_vert,
  meshphysical_frag,
  meshphysical_vert,
  normal_frag,
  normal_vert,
  points_frag,
  points_vert,
  shadow_frag,
  shadow_vert,
  sprite_frag,
  sprite_vert
}, UniformsLib = {
  common: {
    diffuse: { value: new Color(16777215) },
    opacity: { value: 1 },
    map: { value: null },
    uvTransform: { value: new Matrix3() },
    uv2Transform: { value: new Matrix3() },
    alphaMap: { value: null }
  },
  specularmap: {
    specularMap: { value: null }
  },
  envmap: {
    envMap: { value: null },
    flipEnvMap: { value: -1 },
    reflectivity: { value: 1 },
    refractionRatio: { value: 0.98 },
    maxMipLevel: { value: 0 }
  },
  aomap: {
    aoMap: { value: null },
    aoMapIntensity: { value: 1 }
  },
  lightmap: {
    lightMap: { value: null },
    lightMapIntensity: { value: 1 }
  },
  emissivemap: {
    emissiveMap: { value: null }
  },
  bumpmap: {
    bumpMap: { value: null },
    bumpScale: { value: 1 }
  },
  normalmap: {
    normalMap: { value: null },
    normalScale: { value: new Vector2(1, 1) }
  },
  displacementmap: {
    displacementMap: { value: null },
    displacementScale: { value: 1 },
    displacementBias: { value: 0 }
  },
  roughnessmap: {
    roughnessMap: { value: null }
  },
  metalnessmap: {
    metalnessMap: { value: null }
  },
  gradientmap: {
    gradientMap: { value: null }
  },
  fog: {
    fogDensity: { value: 25e-5 },
    fogNear: { value: 1 },
    fogFar: { value: 2e3 },
    fogColor: { value: new Color(16777215) }
  },
  lights: {
    ambientLightColor: { value: [] },
    lightProbe: { value: [] },
    directionalLights: { value: [], properties: {
      direction: {},
      color: {}
    } },
    directionalLightShadows: { value: [], properties: {
      shadowBias: {},
      shadowNormalBias: {},
      shadowRadius: {},
      shadowMapSize: {}
    } },
    directionalShadowMap: { value: [] },
    directionalShadowMatrix: { value: [] },
    spotLights: { value: [], properties: {
      color: {},
      position: {},
      direction: {},
      distance: {},
      coneCos: {},
      penumbraCos: {},
      decay: {}
    } },
    spotLightShadows: { value: [], properties: {
      shadowBias: {},
      shadowNormalBias: {},
      shadowRadius: {},
      shadowMapSize: {}
    } },
    spotShadowMap: { value: [] },
    spotShadowMatrix: { value: [] },
    pointLights: { value: [], properties: {
      color: {},
      position: {},
      decay: {},
      distance: {}
    } },
    pointLightShadows: { value: [], properties: {
      shadowBias: {},
      shadowNormalBias: {},
      shadowRadius: {},
      shadowMapSize: {},
      shadowCameraNear: {},
      shadowCameraFar: {}
    } },
    pointShadowMap: { value: [] },
    pointShadowMatrix: { value: [] },
    hemisphereLights: { value: [], properties: {
      direction: {},
      skyColor: {},
      groundColor: {}
    } },
    rectAreaLights: { value: [], properties: {
      color: {},
      position: {},
      width: {},
      height: {}
    } },
    ltc_1: { value: null },
    ltc_2: { value: null }
  },
  points: {
    diffuse: { value: new Color(16777215) },
    opacity: { value: 1 },
    size: { value: 1 },
    scale: { value: 1 },
    map: { value: null },
    alphaMap: { value: null },
    uvTransform: { value: new Matrix3() }
  },
  sprite: {
    diffuse: { value: new Color(16777215) },
    opacity: { value: 1 },
    center: { value: new Vector2(0.5, 0.5) },
    rotation: { value: 0 },
    map: { value: null },
    alphaMap: { value: null },
    uvTransform: { value: new Matrix3() }
  }
}, ShaderLib = {
  basic: {
    uniforms: mergeUniforms([
      UniformsLib.common,
      UniformsLib.specularmap,
      UniformsLib.envmap,
      UniformsLib.aomap,
      UniformsLib.lightmap,
      UniformsLib.fog
    ]),
    vertexShader: ShaderChunk.meshbasic_vert,
    fragmentShader: ShaderChunk.meshbasic_frag
  },
  lambert: {
    uniforms: mergeUniforms([
      UniformsLib.common,
      UniformsLib.specularmap,
      UniformsLib.envmap,
      UniformsLib.aomap,
      UniformsLib.lightmap,
      UniformsLib.emissivemap,
      UniformsLib.fog,
      UniformsLib.lights,
      {
        emissive: { value: new Color(0) }
      }
    ]),
    vertexShader: ShaderChunk.meshlambert_vert,
    fragmentShader: ShaderChunk.meshlambert_frag
  },
  phong: {
    uniforms: mergeUniforms([
      UniformsLib.common,
      UniformsLib.specularmap,
      UniformsLib.envmap,
      UniformsLib.aomap,
      UniformsLib.lightmap,
      UniformsLib.emissivemap,
      UniformsLib.bumpmap,
      UniformsLib.normalmap,
      UniformsLib.displacementmap,
      UniformsLib.fog,
      UniformsLib.lights,
      {
        emissive: { value: new Color(0) },
        specular: { value: new Color(1118481) },
        shininess: { value: 30 }
      }
    ]),
    vertexShader: ShaderChunk.meshphong_vert,
    fragmentShader: ShaderChunk.meshphong_frag
  },
  standard: {
    uniforms: mergeUniforms([
      UniformsLib.common,
      UniformsLib.envmap,
      UniformsLib.aomap,
      UniformsLib.lightmap,
      UniformsLib.emissivemap,
      UniformsLib.bumpmap,
      UniformsLib.normalmap,
      UniformsLib.displacementmap,
      UniformsLib.roughnessmap,
      UniformsLib.metalnessmap,
      UniformsLib.fog,
      UniformsLib.lights,
      {
        emissive: { value: new Color(0) },
        roughness: { value: 1 },
        metalness: { value: 0 },
        envMapIntensity: { value: 1 }
      }
    ]),
    vertexShader: ShaderChunk.meshphysical_vert,
    fragmentShader: ShaderChunk.meshphysical_frag
  },
  toon: {
    uniforms: mergeUniforms([
      UniformsLib.common,
      UniformsLib.aomap,
      UniformsLib.lightmap,
      UniformsLib.emissivemap,
      UniformsLib.bumpmap,
      UniformsLib.normalmap,
      UniformsLib.displacementmap,
      UniformsLib.gradientmap,
      UniformsLib.fog,
      UniformsLib.lights,
      {
        emissive: { value: new Color(0) }
      }
    ]),
    vertexShader: ShaderChunk.meshtoon_vert,
    fragmentShader: ShaderChunk.meshtoon_frag
  },
  matcap: {
    uniforms: mergeUniforms([
      UniformsLib.common,
      UniformsLib.bumpmap,
      UniformsLib.normalmap,
      UniformsLib.displacementmap,
      UniformsLib.fog,
      {
        matcap: { value: null }
      }
    ]),
    vertexShader: ShaderChunk.meshmatcap_vert,
    fragmentShader: ShaderChunk.meshmatcap_frag
  },
  points: {
    uniforms: mergeUniforms([
      UniformsLib.points,
      UniformsLib.fog
    ]),
    vertexShader: ShaderChunk.points_vert,
    fragmentShader: ShaderChunk.points_frag
  },
  dashed: {
    uniforms: mergeUniforms([
      UniformsLib.common,
      UniformsLib.fog,
      {
        scale: { value: 1 },
        dashSize: { value: 1 },
        totalSize: { value: 2 }
      }
    ]),
    vertexShader: ShaderChunk.linedashed_vert,
    fragmentShader: ShaderChunk.linedashed_frag
  },
  depth: {
    uniforms: mergeUniforms([
      UniformsLib.common,
      UniformsLib.displacementmap
    ]),
    vertexShader: ShaderChunk.depth_vert,
    fragmentShader: ShaderChunk.depth_frag
  },
  normal: {
    uniforms: mergeUniforms([
      UniformsLib.common,
      UniformsLib.bumpmap,
      UniformsLib.normalmap,
      UniformsLib.displacementmap,
      {
        opacity: { value: 1 }
      }
    ]),
    vertexShader: ShaderChunk.normal_vert,
    fragmentShader: ShaderChunk.normal_frag
  },
  sprite: {
    uniforms: mergeUniforms([
      UniformsLib.sprite,
      UniformsLib.fog
    ]),
    vertexShader: ShaderChunk.sprite_vert,
    fragmentShader: ShaderChunk.sprite_frag
  },
  background: {
    uniforms: {
      uvTransform: { value: new Matrix3() },
      t2D: { value: null }
    },
    vertexShader: ShaderChunk.background_vert,
    fragmentShader: ShaderChunk.background_frag
  },
  cube: {
    uniforms: mergeUniforms([
      UniformsLib.envmap,
      {
        opacity: { value: 1 }
      }
    ]),
    vertexShader: ShaderChunk.cube_vert,
    fragmentShader: ShaderChunk.cube_frag
  },
  equirect: {
    uniforms: {
      tEquirect: { value: null }
    },
    vertexShader: ShaderChunk.equirect_vert,
    fragmentShader: ShaderChunk.equirect_frag
  },
  distanceRGBA: {
    uniforms: mergeUniforms([
      UniformsLib.common,
      UniformsLib.displacementmap,
      {
        referencePosition: { value: new Vector3() },
        nearDistance: { value: 1 },
        farDistance: { value: 1e3 }
      }
    ]),
    vertexShader: ShaderChunk.distanceRGBA_vert,
    fragmentShader: ShaderChunk.distanceRGBA_frag
  },
  shadow: {
    uniforms: mergeUniforms([
      UniformsLib.lights,
      UniformsLib.fog,
      {
        color: { value: new Color(0) },
        opacity: { value: 1 }
      }
    ]),
    vertexShader: ShaderChunk.shadow_vert,
    fragmentShader: ShaderChunk.shadow_frag
  }
};
ShaderLib.physical = {
  uniforms: mergeUniforms([
    ShaderLib.standard.uniforms,
    {
      clearcoat: { value: 0 },
      clearcoatMap: { value: null },
      clearcoatRoughness: { value: 0 },
      clearcoatRoughnessMap: { value: null },
      clearcoatNormalScale: { value: new Vector2(1, 1) },
      clearcoatNormalMap: { value: null },
      sheen: { value: new Color(0) },
      transmission: { value: 0 },
      transmissionMap: { value: null },
      transmissionSamplerSize: { value: new Vector2() },
      transmissionSamplerMap: { value: null },
      thickness: { value: 0 },
      thicknessMap: { value: null },
      attenuationDistance: { value: 0 },
      attenuationColor: { value: new Color(0) }
    }
  ]),
  vertexShader: ShaderChunk.meshphysical_vert,
  fragmentShader: ShaderChunk.meshphysical_frag
};
function WebGLBackground(renderer, cubemaps, state, objects, premultipliedAlpha) {
  let clearColor = new Color(0), clearAlpha = 0, planeMesh, boxMesh, currentBackground = null, currentBackgroundVersion = 0, currentTonemapping = null;
  function render(renderList, scene) {
    let forceClear = !1, background = scene.isScene === !0 ? scene.background : null;
    background && background.isTexture && (background = cubemaps.get(background));
    let xr = renderer.xr, session = xr.getSession && xr.getSession();
    session && session.environmentBlendMode === "additive" && (background = null), background === null ? setClear(clearColor, clearAlpha) : background && background.isColor && (setClear(background, 1), forceClear = !0), (renderer.autoClear || forceClear) && renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil), background && (background.isCubeTexture || background.mapping === CubeUVReflectionMapping) ? (boxMesh === void 0 && (boxMesh = new Mesh(new BoxGeometry(1, 1, 1), new ShaderMaterial({
      name: "BackgroundCubeMaterial",
      uniforms: cloneUniforms(ShaderLib.cube.uniforms),
      vertexShader: ShaderLib.cube.vertexShader,
      fragmentShader: ShaderLib.cube.fragmentShader,
      side: BackSide,
      depthTest: !1,
      depthWrite: !1,
      fog: !1
    })), boxMesh.geometry.deleteAttribute("normal"), boxMesh.geometry.deleteAttribute("uv"), boxMesh.onBeforeRender = function(renderer2, scene2, camera) {
      this.matrixWorld.copyPosition(camera.matrixWorld);
    }, Object.defineProperty(boxMesh.material, "envMap", {
      get: function() {
        return this.uniforms.envMap.value;
      }
    }), objects.update(boxMesh)), boxMesh.material.uniforms.envMap.value = background, boxMesh.material.uniforms.flipEnvMap.value = background.isCubeTexture && background._needsFlipEnvMap ? -1 : 1, (currentBackground !== background || currentBackgroundVersion !== background.version || currentTonemapping !== renderer.toneMapping) && (boxMesh.material.needsUpdate = !0, currentBackground = background, currentBackgroundVersion = background.version, currentTonemapping = renderer.toneMapping), renderList.unshift(boxMesh, boxMesh.geometry, boxMesh.material, 0, 0, null)) : background && background.isTexture && (planeMesh === void 0 && (planeMesh = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
      name: "BackgroundMaterial",
      uniforms: cloneUniforms(ShaderLib.background.uniforms),
      vertexShader: ShaderLib.background.vertexShader,
      fragmentShader: ShaderLib.background.fragmentShader,
      side: FrontSide,
      depthTest: !1,
      depthWrite: !1,
      fog: !1
    })), planeMesh.geometry.deleteAttribute("normal"), Object.defineProperty(planeMesh.material, "map", {
      get: function() {
        return this.uniforms.t2D.value;
      }
    }), objects.update(planeMesh)), planeMesh.material.uniforms.t2D.value = background, background.matrixAutoUpdate === !0 && background.updateMatrix(), planeMesh.material.uniforms.uvTransform.value.copy(background.matrix), (currentBackground !== background || currentBackgroundVersion !== background.version || currentTonemapping !== renderer.toneMapping) && (planeMesh.material.needsUpdate = !0, currentBackground = background, currentBackgroundVersion = background.version, currentTonemapping = renderer.toneMapping), renderList.unshift(planeMesh, planeMesh.geometry, planeMesh.material, 0, 0, null));
  }
  function setClear(color, alpha) {
    state.buffers.color.setClear(color.r, color.g, color.b, alpha, premultipliedAlpha);
  }
  return {
    getClearColor: function() {
      return clearColor;
    },
    setClearColor: function(color, alpha = 1) {
      clearColor.set(color), clearAlpha = alpha, setClear(clearColor, clearAlpha);
    },
    getClearAlpha: function() {
      return clearAlpha;
    },
    setClearAlpha: function(alpha) {
      clearAlpha = alpha, setClear(clearColor, clearAlpha);
    },
    render
  };
}
function WebGLBindingStates(gl, extensions, attributes, capabilities) {
  let maxVertexAttributes = gl.getParameter(34921), extension = capabilities.isWebGL2 ? null : extensions.get("OES_vertex_array_object"), vaoAvailable = capabilities.isWebGL2 || extension !== null, bindingStates = {}, defaultState = createBindingState(null), currentState = defaultState;
  function setup(object, material, program, geometry, index) {
    let updateBuffers = !1;
    if (vaoAvailable) {
      let state = getBindingState(geometry, program, material);
      currentState !== state && (currentState = state, bindVertexArrayObject(currentState.object)), updateBuffers = needsUpdate(geometry, index), updateBuffers && saveCache(geometry, index);
    } else {
      let wireframe = material.wireframe === !0;
      (currentState.geometry !== geometry.id || currentState.program !== program.id || currentState.wireframe !== wireframe) && (currentState.geometry = geometry.id, currentState.program = program.id, currentState.wireframe = wireframe, updateBuffers = !0);
    }
    object.isInstancedMesh === !0 && (updateBuffers = !0), index !== null && attributes.update(index, 34963), updateBuffers && (setupVertexAttributes(object, material, program, geometry), index !== null && gl.bindBuffer(34963, attributes.get(index).buffer));
  }
  function createVertexArrayObject() {
    return capabilities.isWebGL2 ? gl.createVertexArray() : extension.createVertexArrayOES();
  }
  function bindVertexArrayObject(vao) {
    return capabilities.isWebGL2 ? gl.bindVertexArray(vao) : extension.bindVertexArrayOES(vao);
  }
  function deleteVertexArrayObject(vao) {
    return capabilities.isWebGL2 ? gl.deleteVertexArray(vao) : extension.deleteVertexArrayOES(vao);
  }
  function getBindingState(geometry, program, material) {
    let wireframe = material.wireframe === !0, programMap = bindingStates[geometry.id];
    programMap === void 0 && (programMap = {}, bindingStates[geometry.id] = programMap);
    let stateMap = programMap[program.id];
    stateMap === void 0 && (stateMap = {}, programMap[program.id] = stateMap);
    let state = stateMap[wireframe];
    return state === void 0 && (state = createBindingState(createVertexArrayObject()), stateMap[wireframe] = state), state;
  }
  function createBindingState(vao) {
    let newAttributes = [], enabledAttributes = [], attributeDivisors = [];
    for (let i = 0; i < maxVertexAttributes; i++)
      newAttributes[i] = 0, enabledAttributes[i] = 0, attributeDivisors[i] = 0;
    return {
      geometry: null,
      program: null,
      wireframe: !1,
      newAttributes,
      enabledAttributes,
      attributeDivisors,
      object: vao,
      attributes: {},
      index: null
    };
  }
  function needsUpdate(geometry, index) {
    let cachedAttributes = currentState.attributes, geometryAttributes = geometry.attributes, attributesNum = 0;
    for (let key in geometryAttributes) {
      let cachedAttribute = cachedAttributes[key], geometryAttribute = geometryAttributes[key];
      if (cachedAttribute === void 0 || cachedAttribute.attribute !== geometryAttribute || cachedAttribute.data !== geometryAttribute.data)
        return !0;
      attributesNum++;
    }
    return currentState.attributesNum !== attributesNum || currentState.index !== index;
  }
  function saveCache(geometry, index) {
    let cache = {}, attributes2 = geometry.attributes, attributesNum = 0;
    for (let key in attributes2) {
      let attribute = attributes2[key], data = {};
      data.attribute = attribute, attribute.data && (data.data = attribute.data), cache[key] = data, attributesNum++;
    }
    currentState.attributes = cache, currentState.attributesNum = attributesNum, currentState.index = index;
  }
  function initAttributes() {
    let newAttributes = currentState.newAttributes;
    for (let i = 0, il = newAttributes.length; i < il; i++)
      newAttributes[i] = 0;
  }
  function enableAttribute(attribute) {
    enableAttributeAndDivisor(attribute, 0);
  }
  function enableAttributeAndDivisor(attribute, meshPerAttribute) {
    let newAttributes = currentState.newAttributes, enabledAttributes = currentState.enabledAttributes, attributeDivisors = currentState.attributeDivisors;
    newAttributes[attribute] = 1, enabledAttributes[attribute] === 0 && (gl.enableVertexAttribArray(attribute), enabledAttributes[attribute] = 1), attributeDivisors[attribute] !== meshPerAttribute && ((capabilities.isWebGL2 ? gl : extensions.get("ANGLE_instanced_arrays"))[capabilities.isWebGL2 ? "vertexAttribDivisor" : "vertexAttribDivisorANGLE"](attribute, meshPerAttribute), attributeDivisors[attribute] = meshPerAttribute);
  }
  function disableUnusedAttributes() {
    let newAttributes = currentState.newAttributes, enabledAttributes = currentState.enabledAttributes;
    for (let i = 0, il = enabledAttributes.length; i < il; i++)
      enabledAttributes[i] !== newAttributes[i] && (gl.disableVertexAttribArray(i), enabledAttributes[i] = 0);
  }
  function vertexAttribPointer(index, size, type, normalized, stride, offset) {
    capabilities.isWebGL2 === !0 && (type === 5124 || type === 5125) ? gl.vertexAttribIPointer(index, size, type, stride, offset) : gl.vertexAttribPointer(index, size, type, normalized, stride, offset);
  }
  function setupVertexAttributes(object, material, program, geometry) {
    if (capabilities.isWebGL2 === !1 && (object.isInstancedMesh || geometry.isInstancedBufferGeometry) && extensions.get("ANGLE_instanced_arrays") === null)
      return;
    initAttributes();
    let geometryAttributes = geometry.attributes, programAttributes = program.getAttributes(), materialDefaultAttributeValues = material.defaultAttributeValues;
    for (let name in programAttributes) {
      let programAttribute = programAttributes[name];
      if (programAttribute >= 0) {
        let geometryAttribute = geometryAttributes[name];
        if (geometryAttribute !== void 0) {
          let normalized = geometryAttribute.normalized, size = geometryAttribute.itemSize, attribute = attributes.get(geometryAttribute);
          if (attribute === void 0)
            continue;
          let buffer = attribute.buffer, type = attribute.type, bytesPerElement = attribute.bytesPerElement;
          if (geometryAttribute.isInterleavedBufferAttribute) {
            let data = geometryAttribute.data, stride = data.stride, offset = geometryAttribute.offset;
            data && data.isInstancedInterleavedBuffer ? (enableAttributeAndDivisor(programAttribute, data.meshPerAttribute), geometry._maxInstanceCount === void 0 && (geometry._maxInstanceCount = data.meshPerAttribute * data.count)) : enableAttribute(programAttribute), gl.bindBuffer(34962, buffer), vertexAttribPointer(programAttribute, size, type, normalized, stride * bytesPerElement, offset * bytesPerElement);
          } else
            geometryAttribute.isInstancedBufferAttribute ? (enableAttributeAndDivisor(programAttribute, geometryAttribute.meshPerAttribute), geometry._maxInstanceCount === void 0 && (geometry._maxInstanceCount = geometryAttribute.meshPerAttribute * geometryAttribute.count)) : enableAttribute(programAttribute), gl.bindBuffer(34962, buffer), vertexAttribPointer(programAttribute, size, type, normalized, 0, 0);
        } else if (name === "instanceMatrix") {
          let attribute = attributes.get(object.instanceMatrix);
          if (attribute === void 0)
            continue;
          let buffer = attribute.buffer, type = attribute.type;
          enableAttributeAndDivisor(programAttribute + 0, 1), enableAttributeAndDivisor(programAttribute + 1, 1), enableAttributeAndDivisor(programAttribute + 2, 1), enableAttributeAndDivisor(programAttribute + 3, 1), gl.bindBuffer(34962, buffer), gl.vertexAttribPointer(programAttribute + 0, 4, type, !1, 64, 0), gl.vertexAttribPointer(programAttribute + 1, 4, type, !1, 64, 16), gl.vertexAttribPointer(programAttribute + 2, 4, type, !1, 64, 32), gl.vertexAttribPointer(programAttribute + 3, 4, type, !1, 64, 48);
        } else if (name === "instanceColor") {
          let attribute = attributes.get(object.instanceColor);
          if (attribute === void 0)
            continue;
          let buffer = attribute.buffer, type = attribute.type;
          enableAttributeAndDivisor(programAttribute, 1), gl.bindBuffer(34962, buffer), gl.vertexAttribPointer(programAttribute, 3, type, !1, 12, 0);
        } else if (materialDefaultAttributeValues !== void 0) {
          let value = materialDefaultAttributeValues[name];
          if (value !== void 0)
            switch (value.length) {
              case 2:
                gl.vertexAttrib2fv(programAttribute, value);
                break;
              case 3:
                gl.vertexAttrib3fv(programAttribute, value);
                break;
              case 4:
                gl.vertexAttrib4fv(programAttribute, value);
                break;
              default:
                gl.vertexAttrib1fv(programAttribute, value);
            }
        }
      }
    }
    disableUnusedAttributes();
  }
  function dispose() {
    reset();
    for (let geometryId in bindingStates) {
      let programMap = bindingStates[geometryId];
      for (let programId in programMap) {
        let stateMap = programMap[programId];
        for (let wireframe in stateMap)
          deleteVertexArrayObject(stateMap[wireframe].object), delete stateMap[wireframe];
        delete programMap[programId];
      }
      delete bindingStates[geometryId];
    }
  }
  function releaseStatesOfGeometry(geometry) {
    if (bindingStates[geometry.id] === void 0)
      return;
    let programMap = bindingStates[geometry.id];
    for (let programId in programMap) {
      let stateMap = programMap[programId];
      for (let wireframe in stateMap)
        deleteVertexArrayObject(stateMap[wireframe].object), delete stateMap[wireframe];
      delete programMap[programId];
    }
    delete bindingStates[geometry.id];
  }
  function releaseStatesOfProgram(program) {
    for (let geometryId in bindingStates) {
      let programMap = bindingStates[geometryId];
      if (programMap[program.id] === void 0)
        continue;
      let stateMap = programMap[program.id];
      for (let wireframe in stateMap)
        deleteVertexArrayObject(stateMap[wireframe].object), delete stateMap[wireframe];
      delete programMap[program.id];
    }
  }
  function reset() {
    resetDefaultState(), currentState !== defaultState && (currentState = defaultState, bindVertexArrayObject(currentState.object));
  }
  function resetDefaultState() {
    defaultState.geometry = null, defaultState.program = null, defaultState.wireframe = !1;
  }
  return {
    setup,
    reset,
    resetDefaultState,
    dispose,
    releaseStatesOfGeometry,
    releaseStatesOfProgram,
    initAttributes,
    enableAttribute,
    disableUnusedAttributes
  };
}
function WebGLBufferRenderer(gl, extensions, info, capabilities) {
  let isWebGL2 = capabilities.isWebGL2, mode;
  function setMode(value) {
    mode = value;
  }
  function render(start, count) {
    gl.drawArrays(mode, start, count), info.update(count, mode, 1);
  }
  function renderInstances(start, count, primcount) {
    if (primcount === 0)
      return;
    let extension, methodName;
    if (isWebGL2)
      extension = gl, methodName = "drawArraysInstanced";
    else if (extension = extensions.get("ANGLE_instanced_arrays"), methodName = "drawArraysInstancedANGLE", extension === null) {
      console.error("THREE.WebGLBufferRenderer: using THREE.InstancedBufferGeometry but hardware does not support extension ANGLE_instanced_arrays.");
      return;
    }
    extension[methodName](mode, start, count, primcount), info.update(count, mode, primcount);
  }
  this.setMode = setMode, this.render = render, this.renderInstances = renderInstances;
}
function WebGLCapabilities(gl, extensions, parameters) {
  let maxAnisotropy;
  function getMaxAnisotropy() {
    if (maxAnisotropy !== void 0)
      return maxAnisotropy;
    if (extensions.has("EXT_texture_filter_anisotropic") === !0) {
      let extension = extensions.get("EXT_texture_filter_anisotropic");
      maxAnisotropy = gl.getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    } else
      maxAnisotropy = 0;
    return maxAnisotropy;
  }
  function getMaxPrecision(precision2) {
    if (precision2 === "highp") {
      if (gl.getShaderPrecisionFormat(35633, 36338).precision > 0 && gl.getShaderPrecisionFormat(35632, 36338).precision > 0)
        return "highp";
      precision2 = "mediump";
    }
    return precision2 === "mediump" && gl.getShaderPrecisionFormat(35633, 36337).precision > 0 && gl.getShaderPrecisionFormat(35632, 36337).precision > 0 ? "mediump" : "lowp";
  }
  let isWebGL2 = typeof WebGL2RenderingContext != "undefined" && gl instanceof WebGL2RenderingContext || typeof WebGL2ComputeRenderingContext != "undefined" && gl instanceof WebGL2ComputeRenderingContext, precision = parameters.precision !== void 0 ? parameters.precision : "highp", maxPrecision = getMaxPrecision(precision);
  maxPrecision !== precision && (console.warn("THREE.WebGLRenderer:", precision, "not supported, using", maxPrecision, "instead."), precision = maxPrecision);
  let drawBuffers = isWebGL2 || extensions.has("WEBGL_draw_buffers"), logarithmicDepthBuffer = parameters.logarithmicDepthBuffer === !0, maxTextures = gl.getParameter(34930), maxVertexTextures = gl.getParameter(35660), maxTextureSize = gl.getParameter(3379), maxCubemapSize = gl.getParameter(34076), maxAttributes = gl.getParameter(34921), maxVertexUniforms = gl.getParameter(36347), maxVaryings = gl.getParameter(36348), maxFragmentUniforms = gl.getParameter(36349), vertexTextures = maxVertexTextures > 0, floatFragmentTextures = isWebGL2 || extensions.has("OES_texture_float"), floatVertexTextures = vertexTextures && floatFragmentTextures, maxSamples = isWebGL2 ? gl.getParameter(36183) : 0;
  return {
    isWebGL2,
    drawBuffers,
    getMaxAnisotropy,
    getMaxPrecision,
    precision,
    logarithmicDepthBuffer,
    maxTextures,
    maxVertexTextures,
    maxTextureSize,
    maxCubemapSize,
    maxAttributes,
    maxVertexUniforms,
    maxVaryings,
    maxFragmentUniforms,
    vertexTextures,
    floatFragmentTextures,
    floatVertexTextures,
    maxSamples
  };
}
function WebGLClipping(properties) {
  let scope = this, globalState = null, numGlobalPlanes = 0, localClippingEnabled = !1, renderingShadows = !1, plane = new Plane(), viewNormalMatrix = new Matrix3(), uniform = { value: null, needsUpdate: !1 };
  this.uniform = uniform, this.numPlanes = 0, this.numIntersection = 0, this.init = function(planes, enableLocalClipping, camera) {
    let enabled = planes.length !== 0 || enableLocalClipping || numGlobalPlanes !== 0 || localClippingEnabled;
    return localClippingEnabled = enableLocalClipping, globalState = projectPlanes(planes, camera, 0), numGlobalPlanes = planes.length, enabled;
  }, this.beginShadows = function() {
    renderingShadows = !0, projectPlanes(null);
  }, this.endShadows = function() {
    renderingShadows = !1, resetGlobalState();
  }, this.setState = function(material, camera, useCache) {
    let planes = material.clippingPlanes, clipIntersection = material.clipIntersection, clipShadows = material.clipShadows, materialProperties = properties.get(material);
    if (!localClippingEnabled || planes === null || planes.length === 0 || renderingShadows && !clipShadows)
      renderingShadows ? projectPlanes(null) : resetGlobalState();
    else {
      let nGlobal = renderingShadows ? 0 : numGlobalPlanes, lGlobal = nGlobal * 4, dstArray = materialProperties.clippingState || null;
      uniform.value = dstArray, dstArray = projectPlanes(planes, camera, lGlobal, useCache);
      for (let i = 0; i !== lGlobal; ++i)
        dstArray[i] = globalState[i];
      materialProperties.clippingState = dstArray, this.numIntersection = clipIntersection ? this.numPlanes : 0, this.numPlanes += nGlobal;
    }
  };
  function resetGlobalState() {
    uniform.value !== globalState && (uniform.value = globalState, uniform.needsUpdate = numGlobalPlanes > 0), scope.numPlanes = numGlobalPlanes, scope.numIntersection = 0;
  }
  function projectPlanes(planes, camera, dstOffset, skipTransform) {
    let nPlanes = planes !== null ? planes.length : 0, dstArray = null;
    if (nPlanes !== 0) {
      if (dstArray = uniform.value, skipTransform !== !0 || dstArray === null) {
        let flatSize = dstOffset + nPlanes * 4, viewMatrix = camera.matrixWorldInverse;
        viewNormalMatrix.getNormalMatrix(viewMatrix), (dstArray === null || dstArray.length < flatSize) && (dstArray = new Float32Array(flatSize));
        for (let i = 0, i4 = dstOffset; i !== nPlanes; ++i, i4 += 4)
          plane.copy(planes[i]).applyMatrix4(viewMatrix, viewNormalMatrix), plane.normal.toArray(dstArray, i4), dstArray[i4 + 3] = plane.constant;
      }
      uniform.value = dstArray, uniform.needsUpdate = !0;
    }
    return scope.numPlanes = nPlanes, scope.numIntersection = 0, dstArray;
  }
}
function WebGLCubeMaps(renderer) {
  let cubemaps = new WeakMap();
  function mapTextureMapping(texture, mapping) {
    return mapping === EquirectangularReflectionMapping ? texture.mapping = CubeReflectionMapping : mapping === EquirectangularRefractionMapping && (texture.mapping = CubeRefractionMapping), texture;
  }
  function get(texture) {
    if (texture && texture.isTexture) {
      let mapping = texture.mapping;
      if (mapping === EquirectangularReflectionMapping || mapping === EquirectangularRefractionMapping)
        if (cubemaps.has(texture)) {
          let cubemap = cubemaps.get(texture).texture;
          return mapTextureMapping(cubemap, texture.mapping);
        } else {
          let image = texture.image;
          if (image && image.height > 0) {
            let currentRenderTarget = renderer.getRenderTarget(), renderTarget = new WebGLCubeRenderTarget(image.height / 2);
            return renderTarget.fromEquirectangularTexture(renderer, texture), cubemaps.set(texture, renderTarget), renderer.setRenderTarget(currentRenderTarget), texture.addEventListener("dispose", onTextureDispose), mapTextureMapping(renderTarget.texture, texture.mapping);
          } else
            return null;
        }
    }
    return texture;
  }
  function onTextureDispose(event) {
    let texture = event.target;
    texture.removeEventListener("dispose", onTextureDispose);
    let cubemap = cubemaps.get(texture);
    cubemap !== void 0 && (cubemaps.delete(texture), cubemap.dispose());
  }
  function dispose() {
    cubemaps = new WeakMap();
  }
  return {
    get,
    dispose
  };
}
function WebGLExtensions(gl) {
  let extensions = {};
  function getExtension(name) {
    if (extensions[name] !== void 0)
      return extensions[name];
    let extension;
    switch (name) {
      case "WEBGL_depth_texture":
        extension = gl.getExtension("WEBGL_depth_texture") || gl.getExtension("MOZ_WEBGL_depth_texture") || gl.getExtension("WEBKIT_WEBGL_depth_texture");
        break;
      case "EXT_texture_filter_anisotropic":
        extension = gl.getExtension("EXT_texture_filter_anisotropic") || gl.getExtension("MOZ_EXT_texture_filter_anisotropic") || gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
        break;
      case "WEBGL_compressed_texture_s3tc":
        extension = gl.getExtension("WEBGL_compressed_texture_s3tc") || gl.getExtension("MOZ_WEBGL_compressed_texture_s3tc") || gl.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");
        break;
      case "WEBGL_compressed_texture_pvrtc":
        extension = gl.getExtension("WEBGL_compressed_texture_pvrtc") || gl.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");
        break;
      default:
        extension = gl.getExtension(name);
    }
    return extensions[name] = extension, extension;
  }
  return {
    has: function(name) {
      return getExtension(name) !== null;
    },
    init: function(capabilities) {
      capabilities.isWebGL2 ? getExtension("EXT_color_buffer_float") : (getExtension("WEBGL_depth_texture"), getExtension("OES_texture_float"), getExtension("OES_texture_half_float"), getExtension("OES_texture_half_float_linear"), getExtension("OES_standard_derivatives"), getExtension("OES_element_index_uint"), getExtension("OES_vertex_array_object"), getExtension("ANGLE_instanced_arrays")), getExtension("OES_texture_float_linear"), getExtension("EXT_color_buffer_half_float");
    },
    get: function(name) {
      let extension = getExtension(name);
      return extension === null && console.warn("THREE.WebGLRenderer: " + name + " extension not supported."), extension;
    }
  };
}
function WebGLGeometries(gl, attributes, info, bindingStates) {
  let geometries = {}, wireframeAttributes = new WeakMap();
  function onGeometryDispose(event) {
    let geometry = event.target;
    geometry.index !== null && attributes.remove(geometry.index);
    for (let name in geometry.attributes)
      attributes.remove(geometry.attributes[name]);
    geometry.removeEventListener("dispose", onGeometryDispose), delete geometries[geometry.id];
    let attribute = wireframeAttributes.get(geometry);
    attribute && (attributes.remove(attribute), wireframeAttributes.delete(geometry)), bindingStates.releaseStatesOfGeometry(geometry), geometry.isInstancedBufferGeometry === !0 && delete geometry._maxInstanceCount, info.memory.geometries--;
  }
  function get(object, geometry) {
    return geometries[geometry.id] === !0 || (geometry.addEventListener("dispose", onGeometryDispose), geometries[geometry.id] = !0, info.memory.geometries++), geometry;
  }
  function update(geometry) {
    let geometryAttributes = geometry.attributes;
    for (let name in geometryAttributes)
      attributes.update(geometryAttributes[name], 34962);
    let morphAttributes = geometry.morphAttributes;
    for (let name in morphAttributes) {
      let array = morphAttributes[name];
      for (let i = 0, l = array.length; i < l; i++)
        attributes.update(array[i], 34962);
    }
  }
  function updateWireframeAttribute(geometry) {
    let indices = [], geometryIndex = geometry.index, geometryPosition = geometry.attributes.position, version = 0;
    if (geometryIndex !== null) {
      let array = geometryIndex.array;
      version = geometryIndex.version;
      for (let i = 0, l = array.length; i < l; i += 3) {
        let a = array[i + 0], b = array[i + 1], c = array[i + 2];
        indices.push(a, b, b, c, c, a);
      }
    } else {
      let array = geometryPosition.array;
      version = geometryPosition.version;
      for (let i = 0, l = array.length / 3 - 1; i < l; i += 3) {
        let a = i + 0, b = i + 1, c = i + 2;
        indices.push(a, b, b, c, c, a);
      }
    }
    let attribute = new (arrayMax(indices) > 65535 ? Uint32BufferAttribute : Uint16BufferAttribute)(indices, 1);
    attribute.version = version;
    let previousAttribute = wireframeAttributes.get(geometry);
    previousAttribute && attributes.remove(previousAttribute), wireframeAttributes.set(geometry, attribute);
  }
  function getWireframeAttribute(geometry) {
    let currentAttribute = wireframeAttributes.get(geometry);
    if (currentAttribute) {
      let geometryIndex = geometry.index;
      geometryIndex !== null && currentAttribute.version < geometryIndex.version && updateWireframeAttribute(geometry);
    } else
      updateWireframeAttribute(geometry);
    return wireframeAttributes.get(geometry);
  }
  return {
    get,
    update,
    getWireframeAttribute
  };
}
function WebGLIndexedBufferRenderer(gl, extensions, info, capabilities) {
  let isWebGL2 = capabilities.isWebGL2, mode;
  function setMode(value) {
    mode = value;
  }
  let type, bytesPerElement;
  function setIndex(value) {
    type = value.type, bytesPerElement = value.bytesPerElement;
  }
  function render(start, count) {
    gl.drawElements(mode, count, type, start * bytesPerElement), info.update(count, mode, 1);
  }
  function renderInstances(start, count, primcount) {
    if (primcount === 0)
      return;
    let extension, methodName;
    if (isWebGL2)
      extension = gl, methodName = "drawElementsInstanced";
    else if (extension = extensions.get("ANGLE_instanced_arrays"), methodName = "drawElementsInstancedANGLE", extension === null) {
      console.error("THREE.WebGLIndexedBufferRenderer: using THREE.InstancedBufferGeometry but hardware does not support extension ANGLE_instanced_arrays.");
      return;
    }
    extension[methodName](mode, count, type, start * bytesPerElement, primcount), info.update(count, mode, primcount);
  }
  this.setMode = setMode, this.setIndex = setIndex, this.render = render, this.renderInstances = renderInstances;
}
function WebGLInfo(gl) {
  let memory = {
    geometries: 0,
    textures: 0
  }, render = {
    frame: 0,
    calls: 0,
    triangles: 0,
    points: 0,
    lines: 0
  };
  function update(count, mode, instanceCount) {
    switch (render.calls++, mode) {
      case 4:
        render.triangles += instanceCount * (count / 3);
        break;
      case 1:
        render.lines += instanceCount * (count / 2);
        break;
      case 3:
        render.lines += instanceCount * (count - 1);
        break;
      case 2:
        render.lines += instanceCount * count;
        break;
      case 0:
        render.points += instanceCount * count;
        break;
      default:
        console.error("THREE.WebGLInfo: Unknown draw mode:", mode);
        break;
    }
  }
  function reset() {
    render.frame++, render.calls = 0, render.triangles = 0, render.points = 0, render.lines = 0;
  }
  return {
    memory,
    render,
    programs: null,
    autoReset: !0,
    reset,
    update
  };
}
function numericalSort(a, b) {
  return a[0] - b[0];
}
function absNumericalSort(a, b) {
  return Math.abs(b[1]) - Math.abs(a[1]);
}
function WebGLMorphtargets(gl) {
  let influencesList = {}, morphInfluences = new Float32Array(8), workInfluences = [];
  for (let i = 0; i < 8; i++)
    workInfluences[i] = [i, 0];
  function update(object, geometry, material, program) {
    let objectInfluences = object.morphTargetInfluences, length = objectInfluences === void 0 ? 0 : objectInfluences.length, influences = influencesList[geometry.id];
    if (influences === void 0) {
      influences = [];
      for (let i = 0; i < length; i++)
        influences[i] = [i, 0];
      influencesList[geometry.id] = influences;
    }
    for (let i = 0; i < length; i++) {
      let influence = influences[i];
      influence[0] = i, influence[1] = objectInfluences[i];
    }
    influences.sort(absNumericalSort);
    for (let i = 0; i < 8; i++)
      i < length && influences[i][1] ? (workInfluences[i][0] = influences[i][0], workInfluences[i][1] = influences[i][1]) : (workInfluences[i][0] = Number.MAX_SAFE_INTEGER, workInfluences[i][1] = 0);
    workInfluences.sort(numericalSort);
    let morphTargets = material.morphTargets && geometry.morphAttributes.position, morphNormals = material.morphNormals && geometry.morphAttributes.normal, morphInfluencesSum = 0;
    for (let i = 0; i < 8; i++) {
      let influence = workInfluences[i], index = influence[0], value = influence[1];
      index !== Number.MAX_SAFE_INTEGER && value ? (morphTargets && geometry.getAttribute("morphTarget" + i) !== morphTargets[index] && geometry.setAttribute("morphTarget" + i, morphTargets[index]), morphNormals && geometry.getAttribute("morphNormal" + i) !== morphNormals[index] && geometry.setAttribute("morphNormal" + i, morphNormals[index]), morphInfluences[i] = value, morphInfluencesSum += value) : (morphTargets && geometry.hasAttribute("morphTarget" + i) === !0 && geometry.deleteAttribute("morphTarget" + i), morphNormals && geometry.hasAttribute("morphNormal" + i) === !0 && geometry.deleteAttribute("morphNormal" + i), morphInfluences[i] = 0);
    }
    let morphBaseInfluence = geometry.morphTargetsRelative ? 1 : 1 - morphInfluencesSum;
    program.getUniforms().setValue(gl, "morphTargetBaseInfluence", morphBaseInfluence), program.getUniforms().setValue(gl, "morphTargetInfluences", morphInfluences);
  }
  return {
    update
  };
}
function WebGLObjects(gl, geometries, attributes, info) {
  let updateMap = new WeakMap();
  function update(object) {
    let frame = info.render.frame, geometry = object.geometry, buffergeometry = geometries.get(object, geometry);
    return updateMap.get(buffergeometry) !== frame && (geometries.update(buffergeometry), updateMap.set(buffergeometry, frame)), object.isInstancedMesh && (object.hasEventListener("dispose", onInstancedMeshDispose) === !1 && object.addEventListener("dispose", onInstancedMeshDispose), attributes.update(object.instanceMatrix, 34962), object.instanceColor !== null && attributes.update(object.instanceColor, 34962)), buffergeometry;
  }
  function dispose() {
    updateMap = new WeakMap();
  }
  function onInstancedMeshDispose(event) {
    let instancedMesh = event.target;
    instancedMesh.removeEventListener("dispose", onInstancedMeshDispose), attributes.remove(instancedMesh.instanceMatrix), instancedMesh.instanceColor !== null && attributes.remove(instancedMesh.instanceColor);
  }
  return {
    update,
    dispose
  };
}
var DataTexture2DArray = class extends Texture {
  constructor(data = null, width = 1, height = 1, depth = 1) {
    super(null);
    this.image = { data, width, height, depth }, this.magFilter = NearestFilter, this.minFilter = NearestFilter, this.wrapR = ClampToEdgeWrapping, this.generateMipmaps = !1, this.flipY = !1, this.unpackAlignment = 1, this.needsUpdate = !0;
  }
};
DataTexture2DArray.prototype.isDataTexture2DArray = !0;
var DataTexture3D = class extends Texture {
  constructor(data = null, width = 1, height = 1, depth = 1) {
    super(null);
    this.image = { data, width, height, depth }, this.magFilter = NearestFilter, this.minFilter = NearestFilter, this.wrapR = ClampToEdgeWrapping, this.generateMipmaps = !1, this.flipY = !1, this.unpackAlignment = 1, this.needsUpdate = !0;
  }
};
DataTexture3D.prototype.isDataTexture3D = !0;
var emptyTexture = new Texture(), emptyTexture2dArray = new DataTexture2DArray(), emptyTexture3d = new DataTexture3D(), emptyCubeTexture = new CubeTexture(), arrayCacheF32 = [], arrayCacheI32 = [], mat4array = new Float32Array(16), mat3array = new Float32Array(9), mat2array = new Float32Array(4);
function flatten(array, nBlocks, blockSize) {
  let firstElem = array[0];
  if (firstElem <= 0 || firstElem > 0)
    return array;
  let n = nBlocks * blockSize, r = arrayCacheF32[n];
  if (r === void 0 && (r = new Float32Array(n), arrayCacheF32[n] = r), nBlocks !== 0) {
    firstElem.toArray(r, 0);
    for (let i = 1, offset = 0; i !== nBlocks; ++i)
      offset += blockSize, array[i].toArray(r, offset);
  }
  return r;
}
function arraysEqual(a, b) {
  if (a.length !== b.length)
    return !1;
  for (let i = 0, l = a.length; i < l; i++)
    if (a[i] !== b[i])
      return !1;
  return !0;
}
function copyArray(a, b) {
  for (let i = 0, l = b.length; i < l; i++)
    a[i] = b[i];
}
function allocTexUnits(textures, n) {
  let r = arrayCacheI32[n];
  r === void 0 && (r = new Int32Array(n), arrayCacheI32[n] = r);
  for (let i = 0; i !== n; ++i)
    r[i] = textures.allocateTextureUnit();
  return r;
}
function setValueV1f(gl, v) {
  let cache = this.cache;
  cache[0] !== v && (gl.uniform1f(this.addr, v), cache[0] = v);
}
function setValueV2f(gl, v) {
  let cache = this.cache;
  if (v.x !== void 0)
    (cache[0] !== v.x || cache[1] !== v.y) && (gl.uniform2f(this.addr, v.x, v.y), cache[0] = v.x, cache[1] = v.y);
  else {
    if (arraysEqual(cache, v))
      return;
    gl.uniform2fv(this.addr, v), copyArray(cache, v);
  }
}
function setValueV3f(gl, v) {
  let cache = this.cache;
  if (v.x !== void 0)
    (cache[0] !== v.x || cache[1] !== v.y || cache[2] !== v.z) && (gl.uniform3f(this.addr, v.x, v.y, v.z), cache[0] = v.x, cache[1] = v.y, cache[2] = v.z);
  else if (v.r !== void 0)
    (cache[0] !== v.r || cache[1] !== v.g || cache[2] !== v.b) && (gl.uniform3f(this.addr, v.r, v.g, v.b), cache[0] = v.r, cache[1] = v.g, cache[2] = v.b);
  else {
    if (arraysEqual(cache, v))
      return;
    gl.uniform3fv(this.addr, v), copyArray(cache, v);
  }
}
function setValueV4f(gl, v) {
  let cache = this.cache;
  if (v.x !== void 0)
    (cache[0] !== v.x || cache[1] !== v.y || cache[2] !== v.z || cache[3] !== v.w) && (gl.uniform4f(this.addr, v.x, v.y, v.z, v.w), cache[0] = v.x, cache[1] = v.y, cache[2] = v.z, cache[3] = v.w);
  else {
    if (arraysEqual(cache, v))
      return;
    gl.uniform4fv(this.addr, v), copyArray(cache, v);
  }
}
function setValueM2(gl, v) {
  let cache = this.cache, elements = v.elements;
  if (elements === void 0) {
    if (arraysEqual(cache, v))
      return;
    gl.uniformMatrix2fv(this.addr, !1, v), copyArray(cache, v);
  } else {
    if (arraysEqual(cache, elements))
      return;
    mat2array.set(elements), gl.uniformMatrix2fv(this.addr, !1, mat2array), copyArray(cache, elements);
  }
}
function setValueM3(gl, v) {
  let cache = this.cache, elements = v.elements;
  if (elements === void 0) {
    if (arraysEqual(cache, v))
      return;
    gl.uniformMatrix3fv(this.addr, !1, v), copyArray(cache, v);
  } else {
    if (arraysEqual(cache, elements))
      return;
    mat3array.set(elements), gl.uniformMatrix3fv(this.addr, !1, mat3array), copyArray(cache, elements);
  }
}
function setValueM4(gl, v) {
  let cache = this.cache, elements = v.elements;
  if (elements === void 0) {
    if (arraysEqual(cache, v))
      return;
    gl.uniformMatrix4fv(this.addr, !1, v), copyArray(cache, v);
  } else {
    if (arraysEqual(cache, elements))
      return;
    mat4array.set(elements), gl.uniformMatrix4fv(this.addr, !1, mat4array), copyArray(cache, elements);
  }
}
function setValueV1i(gl, v) {
  let cache = this.cache;
  cache[0] !== v && (gl.uniform1i(this.addr, v), cache[0] = v);
}
function setValueV2i(gl, v) {
  let cache = this.cache;
  arraysEqual(cache, v) || (gl.uniform2iv(this.addr, v), copyArray(cache, v));
}
function setValueV3i(gl, v) {
  let cache = this.cache;
  arraysEqual(cache, v) || (gl.uniform3iv(this.addr, v), copyArray(cache, v));
}
function setValueV4i(gl, v) {
  let cache = this.cache;
  arraysEqual(cache, v) || (gl.uniform4iv(this.addr, v), copyArray(cache, v));
}
function setValueV1ui(gl, v) {
  let cache = this.cache;
  cache[0] !== v && (gl.uniform1ui(this.addr, v), cache[0] = v);
}
function setValueV2ui(gl, v) {
  let cache = this.cache;
  arraysEqual(cache, v) || (gl.uniform2uiv(this.addr, v), copyArray(cache, v));
}
function setValueV3ui(gl, v) {
  let cache = this.cache;
  arraysEqual(cache, v) || (gl.uniform3uiv(this.addr, v), copyArray(cache, v));
}
function setValueV4ui(gl, v) {
  let cache = this.cache;
  arraysEqual(cache, v) || (gl.uniform4uiv(this.addr, v), copyArray(cache, v));
}
function setValueT1(gl, v, textures) {
  let cache = this.cache, unit = textures.allocateTextureUnit();
  cache[0] !== unit && (gl.uniform1i(this.addr, unit), cache[0] = unit), textures.safeSetTexture2D(v || emptyTexture, unit);
}
function setValueT3D1(gl, v, textures) {
  let cache = this.cache, unit = textures.allocateTextureUnit();
  cache[0] !== unit && (gl.uniform1i(this.addr, unit), cache[0] = unit), textures.setTexture3D(v || emptyTexture3d, unit);
}
function setValueT6(gl, v, textures) {
  let cache = this.cache, unit = textures.allocateTextureUnit();
  cache[0] !== unit && (gl.uniform1i(this.addr, unit), cache[0] = unit), textures.safeSetTextureCube(v || emptyCubeTexture, unit);
}
function setValueT2DArray1(gl, v, textures) {
  let cache = this.cache, unit = textures.allocateTextureUnit();
  cache[0] !== unit && (gl.uniform1i(this.addr, unit), cache[0] = unit), textures.setTexture2DArray(v || emptyTexture2dArray, unit);
}
function getSingularSetter(type) {
  switch (type) {
    case 5126:
      return setValueV1f;
    case 35664:
      return setValueV2f;
    case 35665:
      return setValueV3f;
    case 35666:
      return setValueV4f;
    case 35674:
      return setValueM2;
    case 35675:
      return setValueM3;
    case 35676:
      return setValueM4;
    case 5124:
    case 35670:
      return setValueV1i;
    case 35667:
    case 35671:
      return setValueV2i;
    case 35668:
    case 35672:
      return setValueV3i;
    case 35669:
    case 35673:
      return setValueV4i;
    case 5125:
      return setValueV1ui;
    case 36294:
      return setValueV2ui;
    case 36295:
      return setValueV3ui;
    case 36296:
      return setValueV4ui;
    case 35678:
    case 36198:
    case 36298:
    case 36306:
    case 35682:
      return setValueT1;
    case 35679:
    case 36299:
    case 36307:
      return setValueT3D1;
    case 35680:
    case 36300:
    case 36308:
    case 36293:
      return setValueT6;
    case 36289:
    case 36303:
    case 36311:
    case 36292:
      return setValueT2DArray1;
  }
}
function setValueV1fArray(gl, v) {
  gl.uniform1fv(this.addr, v);
}
function setValueV2fArray(gl, v) {
  let data = flatten(v, this.size, 2);
  gl.uniform2fv(this.addr, data);
}
function setValueV3fArray(gl, v) {
  let data = flatten(v, this.size, 3);
  gl.uniform3fv(this.addr, data);
}
function setValueV4fArray(gl, v) {
  let data = flatten(v, this.size, 4);
  gl.uniform4fv(this.addr, data);
}
function setValueM2Array(gl, v) {
  let data = flatten(v, this.size, 4);
  gl.uniformMatrix2fv(this.addr, !1, data);
}
function setValueM3Array(gl, v) {
  let data = flatten(v, this.size, 9);
  gl.uniformMatrix3fv(this.addr, !1, data);
}
function setValueM4Array(gl, v) {
  let data = flatten(v, this.size, 16);
  gl.uniformMatrix4fv(this.addr, !1, data);
}
function setValueV1iArray(gl, v) {
  gl.uniform1iv(this.addr, v);
}
function setValueV2iArray(gl, v) {
  gl.uniform2iv(this.addr, v);
}
function setValueV3iArray(gl, v) {
  gl.uniform3iv(this.addr, v);
}
function setValueV4iArray(gl, v) {
  gl.uniform4iv(this.addr, v);
}
function setValueV1uiArray(gl, v) {
  gl.uniform1uiv(this.addr, v);
}
function setValueV2uiArray(gl, v) {
  gl.uniform2uiv(this.addr, v);
}
function setValueV3uiArray(gl, v) {
  gl.uniform3uiv(this.addr, v);
}
function setValueV4uiArray(gl, v) {
  gl.uniform4uiv(this.addr, v);
}
function setValueT1Array(gl, v, textures) {
  let n = v.length, units = allocTexUnits(textures, n);
  gl.uniform1iv(this.addr, units);
  for (let i = 0; i !== n; ++i)
    textures.safeSetTexture2D(v[i] || emptyTexture, units[i]);
}
function setValueT6Array(gl, v, textures) {
  let n = v.length, units = allocTexUnits(textures, n);
  gl.uniform1iv(this.addr, units);
  for (let i = 0; i !== n; ++i)
    textures.safeSetTextureCube(v[i] || emptyCubeTexture, units[i]);
}
function getPureArraySetter(type) {
  switch (type) {
    case 5126:
      return setValueV1fArray;
    case 35664:
      return setValueV2fArray;
    case 35665:
      return setValueV3fArray;
    case 35666:
      return setValueV4fArray;
    case 35674:
      return setValueM2Array;
    case 35675:
      return setValueM3Array;
    case 35676:
      return setValueM4Array;
    case 5124:
    case 35670:
      return setValueV1iArray;
    case 35667:
    case 35671:
      return setValueV2iArray;
    case 35668:
    case 35672:
      return setValueV3iArray;
    case 35669:
    case 35673:
      return setValueV4iArray;
    case 5125:
      return setValueV1uiArray;
    case 36294:
      return setValueV2uiArray;
    case 36295:
      return setValueV3uiArray;
    case 36296:
      return setValueV4uiArray;
    case 35678:
    case 36198:
    case 36298:
    case 36306:
    case 35682:
      return setValueT1Array;
    case 35680:
    case 36300:
    case 36308:
    case 36293:
      return setValueT6Array;
  }
}
function SingleUniform(id, activeInfo, addr) {
  this.id = id, this.addr = addr, this.cache = [], this.setValue = getSingularSetter(activeInfo.type);
}
function PureArrayUniform(id, activeInfo, addr) {
  this.id = id, this.addr = addr, this.cache = [], this.size = activeInfo.size, this.setValue = getPureArraySetter(activeInfo.type);
}
PureArrayUniform.prototype.updateCache = function(data) {
  let cache = this.cache;
  data instanceof Float32Array && cache.length !== data.length && (this.cache = new Float32Array(data.length)), copyArray(cache, data);
};
function StructuredUniform(id) {
  this.id = id, this.seq = [], this.map = {};
}
StructuredUniform.prototype.setValue = function(gl, value, textures) {
  let seq = this.seq;
  for (let i = 0, n = seq.length; i !== n; ++i) {
    let u = seq[i];
    u.setValue(gl, value[u.id], textures);
  }
};
var RePathPart = /(\w+)(\])?(\[|\.)?/g;
function addUniform(container, uniformObject) {
  container.seq.push(uniformObject), container.map[uniformObject.id] = uniformObject;
}
function parseUniform(activeInfo, addr, container) {
  let path = activeInfo.name, pathLength = path.length;
  for (RePathPart.lastIndex = 0; ; ) {
    let match = RePathPart.exec(path), matchEnd = RePathPart.lastIndex, id = match[1], idIsIndex = match[2] === "]", subscript = match[3];
    if (idIsIndex && (id = id | 0), subscript === void 0 || subscript === "[" && matchEnd + 2 === pathLength) {
      addUniform(container, subscript === void 0 ? new SingleUniform(id, activeInfo, addr) : new PureArrayUniform(id, activeInfo, addr));
      break;
    } else {
      let next = container.map[id];
      next === void 0 && (next = new StructuredUniform(id), addUniform(container, next)), container = next;
    }
  }
}
function WebGLUniforms(gl, program) {
  this.seq = [], this.map = {};
  let n = gl.getProgramParameter(program, 35718);
  for (let i = 0; i < n; ++i) {
    let info = gl.getActiveUniform(program, i), addr = gl.getUniformLocation(program, info.name);
    parseUniform(info, addr, this);
  }
}
WebGLUniforms.prototype.setValue = function(gl, name, value, textures) {
  let u = this.map[name];
  u !== void 0 && u.setValue(gl, value, textures);
};
WebGLUniforms.prototype.setOptional = function(gl, object, name) {
  let v = object[name];
  v !== void 0 && this.setValue(gl, name, v);
};
WebGLUniforms.upload = function(gl, seq, values, textures) {
  for (let i = 0, n = seq.length; i !== n; ++i) {
    let u = seq[i], v = values[u.id];
    v.needsUpdate !== !1 && u.setValue(gl, v.value, textures);
  }
};
WebGLUniforms.seqWithValue = function(seq, values) {
  let r = [];
  for (let i = 0, n = seq.length; i !== n; ++i) {
    let u = seq[i];
    u.id in values && r.push(u);
  }
  return r;
};
function WebGLShader(gl, type, string) {
  let shader = gl.createShader(type);
  return gl.shaderSource(shader, string), gl.compileShader(shader), shader;
}
var programIdCount = 0;
function addLineNumbers(string) {
  let lines = string.split(`
`);
  for (let i = 0; i < lines.length; i++)
    lines[i] = i + 1 + ": " + lines[i];
  return lines.join(`
`);
}
function getEncodingComponents(encoding) {
  switch (encoding) {
    case LinearEncoding:
      return ["Linear", "( value )"];
    case sRGBEncoding:
      return ["sRGB", "( value )"];
    case RGBEEncoding:
      return ["RGBE", "( value )"];
    case RGBM7Encoding:
      return ["RGBM", "( value, 7.0 )"];
    case RGBM16Encoding:
      return ["RGBM", "( value, 16.0 )"];
    case RGBDEncoding:
      return ["RGBD", "( value, 256.0 )"];
    case GammaEncoding:
      return ["Gamma", "( value, float( GAMMA_FACTOR ) )"];
    case LogLuvEncoding:
      return ["LogLuv", "( value )"];
    default:
      return console.warn("THREE.WebGLProgram: Unsupported encoding:", encoding), ["Linear", "( value )"];
  }
}
function getShaderErrors(gl, shader, type) {
  let status = gl.getShaderParameter(shader, 35713), log = gl.getShaderInfoLog(shader).trim();
  if (status && log === "")
    return "";
  let source = gl.getShaderSource(shader);
  return "THREE.WebGLShader: gl.getShaderInfoLog() " + type + `
` + log + addLineNumbers(source);
}
function getTexelDecodingFunction(functionName, encoding) {
  let components = getEncodingComponents(encoding);
  return "vec4 " + functionName + "( vec4 value ) { return " + components[0] + "ToLinear" + components[1] + "; }";
}
function getTexelEncodingFunction(functionName, encoding) {
  let components = getEncodingComponents(encoding);
  return "vec4 " + functionName + "( vec4 value ) { return LinearTo" + components[0] + components[1] + "; }";
}
function getToneMappingFunction(functionName, toneMapping) {
  let toneMappingName;
  switch (toneMapping) {
    case LinearToneMapping:
      toneMappingName = "Linear";
      break;
    case ReinhardToneMapping:
      toneMappingName = "Reinhard";
      break;
    case CineonToneMapping:
      toneMappingName = "OptimizedCineon";
      break;
    case ACESFilmicToneMapping:
      toneMappingName = "ACESFilmic";
      break;
    case CustomToneMapping:
      toneMappingName = "Custom";
      break;
    default:
      console.warn("THREE.WebGLProgram: Unsupported toneMapping:", toneMapping), toneMappingName = "Linear";
  }
  return "vec3 " + functionName + "( vec3 color ) { return " + toneMappingName + "ToneMapping( color ); }";
}
function generateExtensions(parameters) {
  return [
    parameters.extensionDerivatives || parameters.envMapCubeUV || parameters.bumpMap || parameters.tangentSpaceNormalMap || parameters.clearcoatNormalMap || parameters.flatShading || parameters.shaderID === "physical" ? "#extension GL_OES_standard_derivatives : enable" : "",
    (parameters.extensionFragDepth || parameters.logarithmicDepthBuffer) && parameters.rendererExtensionFragDepth ? "#extension GL_EXT_frag_depth : enable" : "",
    parameters.extensionDrawBuffers && parameters.rendererExtensionDrawBuffers ? "#extension GL_EXT_draw_buffers : require" : "",
    (parameters.extensionShaderTextureLOD || parameters.envMap || parameters.transmission > 0) && parameters.rendererExtensionShaderTextureLod ? "#extension GL_EXT_shader_texture_lod : enable" : ""
  ].filter(filterEmptyLine).join(`
`);
}
function generateDefines(defines) {
  let chunks = [];
  for (let name in defines) {
    let value = defines[name];
    value !== !1 && chunks.push("#define " + name + " " + value);
  }
  return chunks.join(`
`);
}
function fetchAttributeLocations(gl, program) {
  let attributes = {}, n = gl.getProgramParameter(program, 35721);
  for (let i = 0; i < n; i++) {
    let name = gl.getActiveAttrib(program, i).name;
    attributes[name] = gl.getAttribLocation(program, name);
  }
  return attributes;
}
function filterEmptyLine(string) {
  return string !== "";
}
function replaceLightNums(string, parameters) {
  return string.replace(/NUM_DIR_LIGHTS/g, parameters.numDirLights).replace(/NUM_SPOT_LIGHTS/g, parameters.numSpotLights).replace(/NUM_RECT_AREA_LIGHTS/g, parameters.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g, parameters.numPointLights).replace(/NUM_HEMI_LIGHTS/g, parameters.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g, parameters.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS/g, parameters.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g, parameters.numPointLightShadows);
}
function replaceClippingPlaneNums(string, parameters) {
  return string.replace(/NUM_CLIPPING_PLANES/g, parameters.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g, parameters.numClippingPlanes - parameters.numClipIntersection);
}
var includePattern = /^[ \t]*#include +<([\w\d./]+)>/gm;
function resolveIncludes(string) {
  return string.replace(includePattern, includeReplacer);
}
function includeReplacer(match, include) {
  let string = ShaderChunk[include];
  if (string === void 0)
    throw new Error("Can not resolve #include <" + include + ">");
  return resolveIncludes(string);
}
var deprecatedUnrollLoopPattern = /#pragma unroll_loop[\s]+?for \( int i \= (\d+)\; i < (\d+)\; i \+\+ \) \{([\s\S]+?)(?=\})\}/g, unrollLoopPattern = /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;
function unrollLoops(string) {
  return string.replace(unrollLoopPattern, loopReplacer).replace(deprecatedUnrollLoopPattern, deprecatedLoopReplacer);
}
function deprecatedLoopReplacer(match, start, end, snippet) {
  return console.warn("WebGLProgram: #pragma unroll_loop shader syntax is deprecated. Please use #pragma unroll_loop_start syntax instead."), loopReplacer(match, start, end, snippet);
}
function loopReplacer(match, start, end, snippet) {
  let string = "";
  for (let i = parseInt(start); i < parseInt(end); i++)
    string += snippet.replace(/\[\s*i\s*\]/g, "[ " + i + " ]").replace(/UNROLLED_LOOP_INDEX/g, i);
  return string;
}
function generatePrecision(parameters) {
  let precisionstring = "precision " + parameters.precision + ` float;
precision ` + parameters.precision + " int;";
  return parameters.precision === "highp" ? precisionstring += `
#define HIGH_PRECISION` : parameters.precision === "mediump" ? precisionstring += `
#define MEDIUM_PRECISION` : parameters.precision === "lowp" && (precisionstring += `
#define LOW_PRECISION`), precisionstring;
}
function generateShadowMapTypeDefine(parameters) {
  let shadowMapTypeDefine = "SHADOWMAP_TYPE_BASIC";
  return parameters.shadowMapType === PCFShadowMap ? shadowMapTypeDefine = "SHADOWMAP_TYPE_PCF" : parameters.shadowMapType === PCFSoftShadowMap ? shadowMapTypeDefine = "SHADOWMAP_TYPE_PCF_SOFT" : parameters.shadowMapType === VSMShadowMap && (shadowMapTypeDefine = "SHADOWMAP_TYPE_VSM"), shadowMapTypeDefine;
}
function generateEnvMapTypeDefine(parameters) {
  let envMapTypeDefine = "ENVMAP_TYPE_CUBE";
  if (parameters.envMap)
    switch (parameters.envMapMode) {
      case CubeReflectionMapping:
      case CubeRefractionMapping:
        envMapTypeDefine = "ENVMAP_TYPE_CUBE";
        break;
      case CubeUVReflectionMapping:
      case CubeUVRefractionMapping:
        envMapTypeDefine = "ENVMAP_TYPE_CUBE_UV";
        break;
    }
  return envMapTypeDefine;
}
function generateEnvMapModeDefine(parameters) {
  let envMapModeDefine = "ENVMAP_MODE_REFLECTION";
  if (parameters.envMap)
    switch (parameters.envMapMode) {
      case CubeRefractionMapping:
      case CubeUVRefractionMapping:
        envMapModeDefine = "ENVMAP_MODE_REFRACTION";
        break;
    }
  return envMapModeDefine;
}
function generateEnvMapBlendingDefine(parameters) {
  let envMapBlendingDefine = "ENVMAP_BLENDING_NONE";
  if (parameters.envMap)
    switch (parameters.combine) {
      case MultiplyOperation:
        envMapBlendingDefine = "ENVMAP_BLENDING_MULTIPLY";
        break;
      case MixOperation:
        envMapBlendingDefine = "ENVMAP_BLENDING_MIX";
        break;
      case AddOperation:
        envMapBlendingDefine = "ENVMAP_BLENDING_ADD";
        break;
    }
  return envMapBlendingDefine;
}
function WebGLProgram(renderer, cacheKey, parameters, bindingStates) {
  let gl = renderer.getContext(), defines = parameters.defines, vertexShader = parameters.vertexShader, fragmentShader = parameters.fragmentShader, shadowMapTypeDefine = generateShadowMapTypeDefine(parameters), envMapTypeDefine = generateEnvMapTypeDefine(parameters), envMapModeDefine = generateEnvMapModeDefine(parameters), envMapBlendingDefine = generateEnvMapBlendingDefine(parameters), gammaFactorDefine = renderer.gammaFactor > 0 ? renderer.gammaFactor : 1, customExtensions = parameters.isWebGL2 ? "" : generateExtensions(parameters), customDefines = generateDefines(defines), program = gl.createProgram(), prefixVertex, prefixFragment, versionString = parameters.glslVersion ? "#version " + parameters.glslVersion + `
` : "";
  parameters.isRawShaderMaterial ? (prefixVertex = [
    customDefines
  ].filter(filterEmptyLine).join(`
`), prefixVertex.length > 0 && (prefixVertex += `
`), prefixFragment = [
    customExtensions,
    customDefines
  ].filter(filterEmptyLine).join(`
`), prefixFragment.length > 0 && (prefixFragment += `
`)) : (prefixVertex = [
    generatePrecision(parameters),
    "#define SHADER_NAME " + parameters.shaderName,
    customDefines,
    parameters.instancing ? "#define USE_INSTANCING" : "",
    parameters.instancingColor ? "#define USE_INSTANCING_COLOR" : "",
    parameters.supportsVertexTextures ? "#define VERTEX_TEXTURES" : "",
    "#define GAMMA_FACTOR " + gammaFactorDefine,
    "#define MAX_BONES " + parameters.maxBones,
    parameters.useFog && parameters.fog ? "#define USE_FOG" : "",
    parameters.useFog && parameters.fogExp2 ? "#define FOG_EXP2" : "",
    parameters.map ? "#define USE_MAP" : "",
    parameters.envMap ? "#define USE_ENVMAP" : "",
    parameters.envMap ? "#define " + envMapModeDefine : "",
    parameters.lightMap ? "#define USE_LIGHTMAP" : "",
    parameters.aoMap ? "#define USE_AOMAP" : "",
    parameters.emissiveMap ? "#define USE_EMISSIVEMAP" : "",
    parameters.bumpMap ? "#define USE_BUMPMAP" : "",
    parameters.normalMap ? "#define USE_NORMALMAP" : "",
    parameters.normalMap && parameters.objectSpaceNormalMap ? "#define OBJECTSPACE_NORMALMAP" : "",
    parameters.normalMap && parameters.tangentSpaceNormalMap ? "#define TANGENTSPACE_NORMALMAP" : "",
    parameters.clearcoatMap ? "#define USE_CLEARCOATMAP" : "",
    parameters.clearcoatRoughnessMap ? "#define USE_CLEARCOAT_ROUGHNESSMAP" : "",
    parameters.clearcoatNormalMap ? "#define USE_CLEARCOAT_NORMALMAP" : "",
    parameters.displacementMap && parameters.supportsVertexTextures ? "#define USE_DISPLACEMENTMAP" : "",
    parameters.specularMap ? "#define USE_SPECULARMAP" : "",
    parameters.roughnessMap ? "#define USE_ROUGHNESSMAP" : "",
    parameters.metalnessMap ? "#define USE_METALNESSMAP" : "",
    parameters.alphaMap ? "#define USE_ALPHAMAP" : "",
    parameters.transmission ? "#define USE_TRANSMISSION" : "",
    parameters.transmissionMap ? "#define USE_TRANSMISSIONMAP" : "",
    parameters.thicknessMap ? "#define USE_THICKNESSMAP" : "",
    parameters.vertexTangents ? "#define USE_TANGENT" : "",
    parameters.vertexColors ? "#define USE_COLOR" : "",
    parameters.vertexAlphas ? "#define USE_COLOR_ALPHA" : "",
    parameters.vertexUvs ? "#define USE_UV" : "",
    parameters.uvsVertexOnly ? "#define UVS_VERTEX_ONLY" : "",
    parameters.flatShading ? "#define FLAT_SHADED" : "",
    parameters.skinning ? "#define USE_SKINNING" : "",
    parameters.useVertexTexture ? "#define BONE_TEXTURE" : "",
    parameters.morphTargets ? "#define USE_MORPHTARGETS" : "",
    parameters.morphNormals && parameters.flatShading === !1 ? "#define USE_MORPHNORMALS" : "",
    parameters.doubleSided ? "#define DOUBLE_SIDED" : "",
    parameters.flipSided ? "#define FLIP_SIDED" : "",
    parameters.shadowMapEnabled ? "#define USE_SHADOWMAP" : "",
    parameters.shadowMapEnabled ? "#define " + shadowMapTypeDefine : "",
    parameters.sizeAttenuation ? "#define USE_SIZEATTENUATION" : "",
    parameters.logarithmicDepthBuffer ? "#define USE_LOGDEPTHBUF" : "",
    parameters.logarithmicDepthBuffer && parameters.rendererExtensionFragDepth ? "#define USE_LOGDEPTHBUF_EXT" : "",
    "uniform mat4 modelMatrix;",
    "uniform mat4 modelViewMatrix;",
    "uniform mat4 projectionMatrix;",
    "uniform mat4 viewMatrix;",
    "uniform mat3 normalMatrix;",
    "uniform vec3 cameraPosition;",
    "uniform bool isOrthographic;",
    "#ifdef USE_INSTANCING",
    "	attribute mat4 instanceMatrix;",
    "#endif",
    "#ifdef USE_INSTANCING_COLOR",
    "	attribute vec3 instanceColor;",
    "#endif",
    "attribute vec3 position;",
    "attribute vec3 normal;",
    "attribute vec2 uv;",
    "#ifdef USE_TANGENT",
    "	attribute vec4 tangent;",
    "#endif",
    "#if defined( USE_COLOR_ALPHA )",
    "	attribute vec4 color;",
    "#elif defined( USE_COLOR )",
    "	attribute vec3 color;",
    "#endif",
    "#ifdef USE_MORPHTARGETS",
    "	attribute vec3 morphTarget0;",
    "	attribute vec3 morphTarget1;",
    "	attribute vec3 morphTarget2;",
    "	attribute vec3 morphTarget3;",
    "	#ifdef USE_MORPHNORMALS",
    "		attribute vec3 morphNormal0;",
    "		attribute vec3 morphNormal1;",
    "		attribute vec3 morphNormal2;",
    "		attribute vec3 morphNormal3;",
    "	#else",
    "		attribute vec3 morphTarget4;",
    "		attribute vec3 morphTarget5;",
    "		attribute vec3 morphTarget6;",
    "		attribute vec3 morphTarget7;",
    "	#endif",
    "#endif",
    "#ifdef USE_SKINNING",
    "	attribute vec4 skinIndex;",
    "	attribute vec4 skinWeight;",
    "#endif",
    `
`
  ].filter(filterEmptyLine).join(`
`), prefixFragment = [
    customExtensions,
    generatePrecision(parameters),
    "#define SHADER_NAME " + parameters.shaderName,
    customDefines,
    parameters.alphaTest ? "#define ALPHATEST " + parameters.alphaTest + (parameters.alphaTest % 1 ? "" : ".0") : "",
    "#define GAMMA_FACTOR " + gammaFactorDefine,
    parameters.useFog && parameters.fog ? "#define USE_FOG" : "",
    parameters.useFog && parameters.fogExp2 ? "#define FOG_EXP2" : "",
    parameters.map ? "#define USE_MAP" : "",
    parameters.matcap ? "#define USE_MATCAP" : "",
    parameters.envMap ? "#define USE_ENVMAP" : "",
    parameters.envMap ? "#define " + envMapTypeDefine : "",
    parameters.envMap ? "#define " + envMapModeDefine : "",
    parameters.envMap ? "#define " + envMapBlendingDefine : "",
    parameters.lightMap ? "#define USE_LIGHTMAP" : "",
    parameters.aoMap ? "#define USE_AOMAP" : "",
    parameters.emissiveMap ? "#define USE_EMISSIVEMAP" : "",
    parameters.bumpMap ? "#define USE_BUMPMAP" : "",
    parameters.normalMap ? "#define USE_NORMALMAP" : "",
    parameters.normalMap && parameters.objectSpaceNormalMap ? "#define OBJECTSPACE_NORMALMAP" : "",
    parameters.normalMap && parameters.tangentSpaceNormalMap ? "#define TANGENTSPACE_NORMALMAP" : "",
    parameters.clearcoatMap ? "#define USE_CLEARCOATMAP" : "",
    parameters.clearcoatRoughnessMap ? "#define USE_CLEARCOAT_ROUGHNESSMAP" : "",
    parameters.clearcoatNormalMap ? "#define USE_CLEARCOAT_NORMALMAP" : "",
    parameters.specularMap ? "#define USE_SPECULARMAP" : "",
    parameters.roughnessMap ? "#define USE_ROUGHNESSMAP" : "",
    parameters.metalnessMap ? "#define USE_METALNESSMAP" : "",
    parameters.alphaMap ? "#define USE_ALPHAMAP" : "",
    parameters.sheen ? "#define USE_SHEEN" : "",
    parameters.transmission ? "#define USE_TRANSMISSION" : "",
    parameters.transmissionMap ? "#define USE_TRANSMISSIONMAP" : "",
    parameters.thicknessMap ? "#define USE_THICKNESSMAP" : "",
    parameters.vertexTangents ? "#define USE_TANGENT" : "",
    parameters.vertexColors || parameters.instancingColor ? "#define USE_COLOR" : "",
    parameters.vertexAlphas ? "#define USE_COLOR_ALPHA" : "",
    parameters.vertexUvs ? "#define USE_UV" : "",
    parameters.uvsVertexOnly ? "#define UVS_VERTEX_ONLY" : "",
    parameters.gradientMap ? "#define USE_GRADIENTMAP" : "",
    parameters.flatShading ? "#define FLAT_SHADED" : "",
    parameters.doubleSided ? "#define DOUBLE_SIDED" : "",
    parameters.flipSided ? "#define FLIP_SIDED" : "",
    parameters.shadowMapEnabled ? "#define USE_SHADOWMAP" : "",
    parameters.shadowMapEnabled ? "#define " + shadowMapTypeDefine : "",
    parameters.premultipliedAlpha ? "#define PREMULTIPLIED_ALPHA" : "",
    parameters.physicallyCorrectLights ? "#define PHYSICALLY_CORRECT_LIGHTS" : "",
    parameters.logarithmicDepthBuffer ? "#define USE_LOGDEPTHBUF" : "",
    parameters.logarithmicDepthBuffer && parameters.rendererExtensionFragDepth ? "#define USE_LOGDEPTHBUF_EXT" : "",
    (parameters.extensionShaderTextureLOD || parameters.envMap) && parameters.rendererExtensionShaderTextureLod ? "#define TEXTURE_LOD_EXT" : "",
    "uniform mat4 viewMatrix;",
    "uniform vec3 cameraPosition;",
    "uniform bool isOrthographic;",
    parameters.toneMapping !== NoToneMapping ? "#define TONE_MAPPING" : "",
    parameters.toneMapping !== NoToneMapping ? ShaderChunk.tonemapping_pars_fragment : "",
    parameters.toneMapping !== NoToneMapping ? getToneMappingFunction("toneMapping", parameters.toneMapping) : "",
    parameters.dithering ? "#define DITHERING" : "",
    ShaderChunk.encodings_pars_fragment,
    parameters.map ? getTexelDecodingFunction("mapTexelToLinear", parameters.mapEncoding) : "",
    parameters.matcap ? getTexelDecodingFunction("matcapTexelToLinear", parameters.matcapEncoding) : "",
    parameters.envMap ? getTexelDecodingFunction("envMapTexelToLinear", parameters.envMapEncoding) : "",
    parameters.emissiveMap ? getTexelDecodingFunction("emissiveMapTexelToLinear", parameters.emissiveMapEncoding) : "",
    parameters.lightMap ? getTexelDecodingFunction("lightMapTexelToLinear", parameters.lightMapEncoding) : "",
    getTexelEncodingFunction("linearToOutputTexel", parameters.outputEncoding),
    parameters.depthPacking ? "#define DEPTH_PACKING " + parameters.depthPacking : "",
    `
`
  ].filter(filterEmptyLine).join(`
`)), vertexShader = resolveIncludes(vertexShader), vertexShader = replaceLightNums(vertexShader, parameters), vertexShader = replaceClippingPlaneNums(vertexShader, parameters), fragmentShader = resolveIncludes(fragmentShader), fragmentShader = replaceLightNums(fragmentShader, parameters), fragmentShader = replaceClippingPlaneNums(fragmentShader, parameters), vertexShader = unrollLoops(vertexShader), fragmentShader = unrollLoops(fragmentShader), parameters.isWebGL2 && parameters.isRawShaderMaterial !== !0 && (versionString = `#version 300 es
`, prefixVertex = [
    "#define attribute in",
    "#define varying out",
    "#define texture2D texture"
  ].join(`
`) + `
` + prefixVertex, prefixFragment = [
    "#define varying in",
    parameters.glslVersion === GLSL3 ? "" : "out highp vec4 pc_fragColor;",
    parameters.glslVersion === GLSL3 ? "" : "#define gl_FragColor pc_fragColor",
    "#define gl_FragDepthEXT gl_FragDepth",
    "#define texture2D texture",
    "#define textureCube texture",
    "#define texture2DProj textureProj",
    "#define texture2DLodEXT textureLod",
    "#define texture2DProjLodEXT textureProjLod",
    "#define textureCubeLodEXT textureLod",
    "#define texture2DGradEXT textureGrad",
    "#define texture2DProjGradEXT textureProjGrad",
    "#define textureCubeGradEXT textureGrad"
  ].join(`
`) + `
` + prefixFragment);
  let vertexGlsl = versionString + prefixVertex + vertexShader, fragmentGlsl = versionString + prefixFragment + fragmentShader, glVertexShader = WebGLShader(gl, 35633, vertexGlsl), glFragmentShader = WebGLShader(gl, 35632, fragmentGlsl);
  if (gl.attachShader(program, glVertexShader), gl.attachShader(program, glFragmentShader), parameters.index0AttributeName !== void 0 ? gl.bindAttribLocation(program, 0, parameters.index0AttributeName) : parameters.morphTargets === !0 && gl.bindAttribLocation(program, 0, "position"), gl.linkProgram(program), renderer.debug.checkShaderErrors) {
    let programLog = gl.getProgramInfoLog(program).trim(), vertexLog = gl.getShaderInfoLog(glVertexShader).trim(), fragmentLog = gl.getShaderInfoLog(glFragmentShader).trim(), runnable = !0, haveDiagnostics = !0;
    if (gl.getProgramParameter(program, 35714) === !1) {
      runnable = !1;
      let vertexErrors = getShaderErrors(gl, glVertexShader, "vertex"), fragmentErrors = getShaderErrors(gl, glFragmentShader, "fragment");
      console.error("THREE.WebGLProgram: shader error: ", gl.getError(), "35715", gl.getProgramParameter(program, 35715), "gl.getProgramInfoLog", programLog, vertexErrors, fragmentErrors);
    } else
      programLog !== "" ? console.warn("THREE.WebGLProgram: gl.getProgramInfoLog()", programLog) : (vertexLog === "" || fragmentLog === "") && (haveDiagnostics = !1);
    haveDiagnostics && (this.diagnostics = {
      runnable,
      programLog,
      vertexShader: {
        log: vertexLog,
        prefix: prefixVertex
      },
      fragmentShader: {
        log: fragmentLog,
        prefix: prefixFragment
      }
    });
  }
  gl.deleteShader(glVertexShader), gl.deleteShader(glFragmentShader);
  let cachedUniforms;
  this.getUniforms = function() {
    return cachedUniforms === void 0 && (cachedUniforms = new WebGLUniforms(gl, program)), cachedUniforms;
  };
  let cachedAttributes;
  return this.getAttributes = function() {
    return cachedAttributes === void 0 && (cachedAttributes = fetchAttributeLocations(gl, program)), cachedAttributes;
  }, this.destroy = function() {
    bindingStates.releaseStatesOfProgram(this), gl.deleteProgram(program), this.program = void 0;
  }, this.name = parameters.shaderName, this.id = programIdCount++, this.cacheKey = cacheKey, this.usedTimes = 1, this.program = program, this.vertexShader = glVertexShader, this.fragmentShader = glFragmentShader, this;
}
function WebGLPrograms(renderer, cubemaps, extensions, capabilities, bindingStates, clipping) {
  let programs = [], isWebGL2 = capabilities.isWebGL2, logarithmicDepthBuffer = capabilities.logarithmicDepthBuffer, floatVertexTextures = capabilities.floatVertexTextures, maxVertexUniforms = capabilities.maxVertexUniforms, vertexTextures = capabilities.vertexTextures, precision = capabilities.precision, shaderIDs = {
    MeshDepthMaterial: "depth",
    MeshDistanceMaterial: "distanceRGBA",
    MeshNormalMaterial: "normal",
    MeshBasicMaterial: "basic",
    MeshLambertMaterial: "lambert",
    MeshPhongMaterial: "phong",
    MeshToonMaterial: "toon",
    MeshStandardMaterial: "physical",
    MeshPhysicalMaterial: "physical",
    MeshMatcapMaterial: "matcap",
    LineBasicMaterial: "basic",
    LineDashedMaterial: "dashed",
    PointsMaterial: "points",
    ShadowMaterial: "shadow",
    SpriteMaterial: "sprite"
  }, parameterNames = [
    "precision",
    "isWebGL2",
    "supportsVertexTextures",
    "outputEncoding",
    "instancing",
    "instancingColor",
    "map",
    "mapEncoding",
    "matcap",
    "matcapEncoding",
    "envMap",
    "envMapMode",
    "envMapEncoding",
    "envMapCubeUV",
    "lightMap",
    "lightMapEncoding",
    "aoMap",
    "emissiveMap",
    "emissiveMapEncoding",
    "bumpMap",
    "normalMap",
    "objectSpaceNormalMap",
    "tangentSpaceNormalMap",
    "clearcoatMap",
    "clearcoatRoughnessMap",
    "clearcoatNormalMap",
    "displacementMap",
    "specularMap",
    "roughnessMap",
    "metalnessMap",
    "gradientMap",
    "alphaMap",
    "combine",
    "vertexColors",
    "vertexAlphas",
    "vertexTangents",
    "vertexUvs",
    "uvsVertexOnly",
    "fog",
    "useFog",
    "fogExp2",
    "flatShading",
    "sizeAttenuation",
    "logarithmicDepthBuffer",
    "skinning",
    "maxBones",
    "useVertexTexture",
    "morphTargets",
    "morphNormals",
    "premultipliedAlpha",
    "numDirLights",
    "numPointLights",
    "numSpotLights",
    "numHemiLights",
    "numRectAreaLights",
    "numDirLightShadows",
    "numPointLightShadows",
    "numSpotLightShadows",
    "shadowMapEnabled",
    "shadowMapType",
    "toneMapping",
    "physicallyCorrectLights",
    "alphaTest",
    "doubleSided",
    "flipSided",
    "numClippingPlanes",
    "numClipIntersection",
    "depthPacking",
    "dithering",
    "sheen",
    "transmission",
    "transmissionMap",
    "thicknessMap"
  ];
  function getMaxBones(object) {
    let bones = object.skeleton.bones;
    if (floatVertexTextures)
      return 1024;
    {
      let nVertexMatrices = Math.floor((maxVertexUniforms - 20) / 4), maxBones = Math.min(nVertexMatrices, bones.length);
      return maxBones < bones.length ? (console.warn("THREE.WebGLRenderer: Skeleton has " + bones.length + " bones. This GPU supports " + maxBones + "."), 0) : maxBones;
    }
  }
  function getTextureEncodingFromMap(map) {
    let encoding;
    return map && map.isTexture ? encoding = map.encoding : map && map.isWebGLRenderTarget ? (console.warn("THREE.WebGLPrograms.getTextureEncodingFromMap: don't use render targets as textures. Use their .texture property instead."), encoding = map.texture.encoding) : encoding = LinearEncoding, encoding;
  }
  function getParameters(material, lights, shadows, scene, object) {
    let fog = scene.fog, environment = material.isMeshStandardMaterial ? scene.environment : null, envMap = cubemaps.get(material.envMap || environment), shaderID = shaderIDs[material.type], maxBones = object.isSkinnedMesh ? getMaxBones(object) : 0;
    material.precision !== null && (precision = capabilities.getMaxPrecision(material.precision), precision !== material.precision && console.warn("THREE.WebGLProgram.getParameters:", material.precision, "not supported, using", precision, "instead."));
    let vertexShader, fragmentShader;
    if (shaderID) {
      let shader = ShaderLib[shaderID];
      vertexShader = shader.vertexShader, fragmentShader = shader.fragmentShader;
    } else
      vertexShader = material.vertexShader, fragmentShader = material.fragmentShader;
    let currentRenderTarget = renderer.getRenderTarget();
    return {
      isWebGL2,
      shaderID,
      shaderName: material.type,
      vertexShader,
      fragmentShader,
      defines: material.defines,
      isRawShaderMaterial: material.isRawShaderMaterial === !0,
      glslVersion: material.glslVersion,
      precision,
      instancing: object.isInstancedMesh === !0,
      instancingColor: object.isInstancedMesh === !0 && object.instanceColor !== null,
      supportsVertexTextures: vertexTextures,
      outputEncoding: currentRenderTarget !== null ? getTextureEncodingFromMap(currentRenderTarget.texture) : renderer.outputEncoding,
      map: !!material.map,
      mapEncoding: getTextureEncodingFromMap(material.map),
      matcap: !!material.matcap,
      matcapEncoding: getTextureEncodingFromMap(material.matcap),
      envMap: !!envMap,
      envMapMode: envMap && envMap.mapping,
      envMapEncoding: getTextureEncodingFromMap(envMap),
      envMapCubeUV: !!envMap && (envMap.mapping === CubeUVReflectionMapping || envMap.mapping === CubeUVRefractionMapping),
      lightMap: !!material.lightMap,
      lightMapEncoding: getTextureEncodingFromMap(material.lightMap),
      aoMap: !!material.aoMap,
      emissiveMap: !!material.emissiveMap,
      emissiveMapEncoding: getTextureEncodingFromMap(material.emissiveMap),
      bumpMap: !!material.bumpMap,
      normalMap: !!material.normalMap,
      objectSpaceNormalMap: material.normalMapType === ObjectSpaceNormalMap,
      tangentSpaceNormalMap: material.normalMapType === TangentSpaceNormalMap,
      clearcoatMap: !!material.clearcoatMap,
      clearcoatRoughnessMap: !!material.clearcoatRoughnessMap,
      clearcoatNormalMap: !!material.clearcoatNormalMap,
      displacementMap: !!material.displacementMap,
      roughnessMap: !!material.roughnessMap,
      metalnessMap: !!material.metalnessMap,
      specularMap: !!material.specularMap,
      alphaMap: !!material.alphaMap,
      gradientMap: !!material.gradientMap,
      sheen: !!material.sheen,
      transmission: !!material.transmission,
      transmissionMap: !!material.transmissionMap,
      thicknessMap: !!material.thicknessMap,
      combine: material.combine,
      vertexTangents: material.normalMap && material.vertexTangents,
      vertexColors: material.vertexColors,
      vertexAlphas: material.vertexColors === !0 && object.geometry && object.geometry.attributes.color && object.geometry.attributes.color.itemSize === 4,
      vertexUvs: !!material.map || !!material.bumpMap || !!material.normalMap || !!material.specularMap || !!material.alphaMap || !!material.emissiveMap || !!material.roughnessMap || !!material.metalnessMap || !!material.clearcoatMap || !!material.clearcoatRoughnessMap || !!material.clearcoatNormalMap || !!material.displacementMap || !!material.transmission || !!material.transmissionMap || !!material.thicknessMap,
      uvsVertexOnly: !(!!material.map || !!material.bumpMap || !!material.normalMap || !!material.specularMap || !!material.alphaMap || !!material.emissiveMap || !!material.roughnessMap || !!material.metalnessMap || !!material.clearcoatNormalMap || !!material.transmission || !!material.transmissionMap || !!material.thicknessMap) && !!material.displacementMap,
      fog: !!fog,
      useFog: material.fog,
      fogExp2: fog && fog.isFogExp2,
      flatShading: !!material.flatShading,
      sizeAttenuation: material.sizeAttenuation,
      logarithmicDepthBuffer,
      skinning: object.isSkinnedMesh === !0 && maxBones > 0,
      maxBones,
      useVertexTexture: floatVertexTextures,
      morphTargets: material.morphTargets,
      morphNormals: material.morphNormals,
      numDirLights: lights.directional.length,
      numPointLights: lights.point.length,
      numSpotLights: lights.spot.length,
      numRectAreaLights: lights.rectArea.length,
      numHemiLights: lights.hemi.length,
      numDirLightShadows: lights.directionalShadowMap.length,
      numPointLightShadows: lights.pointShadowMap.length,
      numSpotLightShadows: lights.spotShadowMap.length,
      numClippingPlanes: clipping.numPlanes,
      numClipIntersection: clipping.numIntersection,
      dithering: material.dithering,
      shadowMapEnabled: renderer.shadowMap.enabled && shadows.length > 0,
      shadowMapType: renderer.shadowMap.type,
      toneMapping: material.toneMapped ? renderer.toneMapping : NoToneMapping,
      physicallyCorrectLights: renderer.physicallyCorrectLights,
      premultipliedAlpha: material.premultipliedAlpha,
      alphaTest: material.alphaTest,
      doubleSided: material.side === DoubleSide,
      flipSided: material.side === BackSide,
      depthPacking: material.depthPacking !== void 0 ? material.depthPacking : !1,
      index0AttributeName: material.index0AttributeName,
      extensionDerivatives: material.extensions && material.extensions.derivatives,
      extensionFragDepth: material.extensions && material.extensions.fragDepth,
      extensionDrawBuffers: material.extensions && material.extensions.drawBuffers,
      extensionShaderTextureLOD: material.extensions && material.extensions.shaderTextureLOD,
      rendererExtensionFragDepth: isWebGL2 || extensions.has("EXT_frag_depth"),
      rendererExtensionDrawBuffers: isWebGL2 || extensions.has("WEBGL_draw_buffers"),
      rendererExtensionShaderTextureLod: isWebGL2 || extensions.has("EXT_shader_texture_lod"),
      customProgramCacheKey: material.customProgramCacheKey()
    };
  }
  function getProgramCacheKey(parameters) {
    let array = [];
    if (parameters.shaderID ? array.push(parameters.shaderID) : (array.push(parameters.fragmentShader), array.push(parameters.vertexShader)), parameters.defines !== void 0)
      for (let name in parameters.defines)
        array.push(name), array.push(parameters.defines[name]);
    if (parameters.isRawShaderMaterial === !1) {
      for (let i = 0; i < parameterNames.length; i++)
        array.push(parameters[parameterNames[i]]);
      array.push(renderer.outputEncoding), array.push(renderer.gammaFactor);
    }
    return array.push(parameters.customProgramCacheKey), array.join();
  }
  function getUniforms(material) {
    let shaderID = shaderIDs[material.type], uniforms;
    if (shaderID) {
      let shader = ShaderLib[shaderID];
      uniforms = UniformsUtils.clone(shader.uniforms);
    } else
      uniforms = material.uniforms;
    return uniforms;
  }
  function acquireProgram(parameters, cacheKey) {
    let program;
    for (let p = 0, pl = programs.length; p < pl; p++) {
      let preexistingProgram = programs[p];
      if (preexistingProgram.cacheKey === cacheKey) {
        program = preexistingProgram, ++program.usedTimes;
        break;
      }
    }
    return program === void 0 && (program = new WebGLProgram(renderer, cacheKey, parameters, bindingStates), programs.push(program)), program;
  }
  function releaseProgram(program) {
    if (--program.usedTimes == 0) {
      let i = programs.indexOf(program);
      programs[i] = programs[programs.length - 1], programs.pop(), program.destroy();
    }
  }
  return {
    getParameters,
    getProgramCacheKey,
    getUniforms,
    acquireProgram,
    releaseProgram,
    programs
  };
}
function WebGLProperties() {
  let properties = new WeakMap();
  function get(object) {
    let map = properties.get(object);
    return map === void 0 && (map = {}, properties.set(object, map)), map;
  }
  function remove(object) {
    properties.delete(object);
  }
  function update(object, key, value) {
    properties.get(object)[key] = value;
  }
  function dispose() {
    properties = new WeakMap();
  }
  return {
    get,
    remove,
    update,
    dispose
  };
}
function painterSortStable(a, b) {
  return a.groupOrder !== b.groupOrder ? a.groupOrder - b.groupOrder : a.renderOrder !== b.renderOrder ? a.renderOrder - b.renderOrder : a.program !== b.program ? a.program.id - b.program.id : a.material.id !== b.material.id ? a.material.id - b.material.id : a.z !== b.z ? a.z - b.z : a.id - b.id;
}
function reversePainterSortStable(a, b) {
  return a.groupOrder !== b.groupOrder ? a.groupOrder - b.groupOrder : a.renderOrder !== b.renderOrder ? a.renderOrder - b.renderOrder : a.z !== b.z ? b.z - a.z : a.id - b.id;
}
function WebGLRenderList(properties) {
  let renderItems = [], renderItemsIndex = 0, opaque = [], transmissive = [], transparent = [], defaultProgram = { id: -1 };
  function init() {
    renderItemsIndex = 0, opaque.length = 0, transmissive.length = 0, transparent.length = 0;
  }
  function getNextRenderItem(object, geometry, material, groupOrder, z, group) {
    let renderItem = renderItems[renderItemsIndex], materialProperties = properties.get(material);
    return renderItem === void 0 ? (renderItem = {
      id: object.id,
      object,
      geometry,
      material,
      program: materialProperties.program || defaultProgram,
      groupOrder,
      renderOrder: object.renderOrder,
      z,
      group
    }, renderItems[renderItemsIndex] = renderItem) : (renderItem.id = object.id, renderItem.object = object, renderItem.geometry = geometry, renderItem.material = material, renderItem.program = materialProperties.program || defaultProgram, renderItem.groupOrder = groupOrder, renderItem.renderOrder = object.renderOrder, renderItem.z = z, renderItem.group = group), renderItemsIndex++, renderItem;
  }
  function push(object, geometry, material, groupOrder, z, group) {
    let renderItem = getNextRenderItem(object, geometry, material, groupOrder, z, group);
    material.transmission > 0 ? transmissive.push(renderItem) : material.transparent === !0 ? transparent.push(renderItem) : opaque.push(renderItem);
  }
  function unshift(object, geometry, material, groupOrder, z, group) {
    let renderItem = getNextRenderItem(object, geometry, material, groupOrder, z, group);
    material.transmission > 0 ? transmissive.unshift(renderItem) : material.transparent === !0 ? transparent.unshift(renderItem) : opaque.unshift(renderItem);
  }
  function sort(customOpaqueSort, customTransparentSort) {
    opaque.length > 1 && opaque.sort(customOpaqueSort || painterSortStable), transmissive.length > 1 && transmissive.sort(customTransparentSort || reversePainterSortStable), transparent.length > 1 && transparent.sort(customTransparentSort || reversePainterSortStable);
  }
  function finish() {
    for (let i = renderItemsIndex, il = renderItems.length; i < il; i++) {
      let renderItem = renderItems[i];
      if (renderItem.id === null)
        break;
      renderItem.id = null, renderItem.object = null, renderItem.geometry = null, renderItem.material = null, renderItem.program = null, renderItem.group = null;
    }
  }
  return {
    opaque,
    transmissive,
    transparent,
    init,
    push,
    unshift,
    finish,
    sort
  };
}
function WebGLRenderLists(properties) {
  let lists = new WeakMap();
  function get(scene, renderCallDepth) {
    let list;
    return lists.has(scene) === !1 ? (list = new WebGLRenderList(properties), lists.set(scene, [list])) : renderCallDepth >= lists.get(scene).length ? (list = new WebGLRenderList(properties), lists.get(scene).push(list)) : list = lists.get(scene)[renderCallDepth], list;
  }
  function dispose() {
    lists = new WeakMap();
  }
  return {
    get,
    dispose
  };
}
function UniformsCache() {
  let lights = {};
  return {
    get: function(light) {
      if (lights[light.id] !== void 0)
        return lights[light.id];
      let uniforms;
      switch (light.type) {
        case "DirectionalLight":
          uniforms = {
            direction: new Vector3(),
            color: new Color()
          };
          break;
        case "SpotLight":
          uniforms = {
            position: new Vector3(),
            direction: new Vector3(),
            color: new Color(),
            distance: 0,
            coneCos: 0,
            penumbraCos: 0,
            decay: 0
          };
          break;
        case "PointLight":
          uniforms = {
            position: new Vector3(),
            color: new Color(),
            distance: 0,
            decay: 0
          };
          break;
        case "HemisphereLight":
          uniforms = {
            direction: new Vector3(),
            skyColor: new Color(),
            groundColor: new Color()
          };
          break;
        case "RectAreaLight":
          uniforms = {
            color: new Color(),
            position: new Vector3(),
            halfWidth: new Vector3(),
            halfHeight: new Vector3()
          };
          break;
      }
      return lights[light.id] = uniforms, uniforms;
    }
  };
}
function ShadowUniformsCache() {
  let lights = {};
  return {
    get: function(light) {
      if (lights[light.id] !== void 0)
        return lights[light.id];
      let uniforms;
      switch (light.type) {
        case "DirectionalLight":
          uniforms = {
            shadowBias: 0,
            shadowNormalBias: 0,
            shadowRadius: 1,
            shadowMapSize: new Vector2()
          };
          break;
        case "SpotLight":
          uniforms = {
            shadowBias: 0,
            shadowNormalBias: 0,
            shadowRadius: 1,
            shadowMapSize: new Vector2()
          };
          break;
        case "PointLight":
          uniforms = {
            shadowBias: 0,
            shadowNormalBias: 0,
            shadowRadius: 1,
            shadowMapSize: new Vector2(),
            shadowCameraNear: 1,
            shadowCameraFar: 1e3
          };
          break;
      }
      return lights[light.id] = uniforms, uniforms;
    }
  };
}
var nextVersion = 0;
function shadowCastingLightsFirst(lightA, lightB) {
  return (lightB.castShadow ? 1 : 0) - (lightA.castShadow ? 1 : 0);
}
function WebGLLights(extensions, capabilities) {
  let cache = new UniformsCache(), shadowCache = ShadowUniformsCache(), state = {
    version: 0,
    hash: {
      directionalLength: -1,
      pointLength: -1,
      spotLength: -1,
      rectAreaLength: -1,
      hemiLength: -1,
      numDirectionalShadows: -1,
      numPointShadows: -1,
      numSpotShadows: -1
    },
    ambient: [0, 0, 0],
    probe: [],
    directional: [],
    directionalShadow: [],
    directionalShadowMap: [],
    directionalShadowMatrix: [],
    spot: [],
    spotShadow: [],
    spotShadowMap: [],
    spotShadowMatrix: [],
    rectArea: [],
    rectAreaLTC1: null,
    rectAreaLTC2: null,
    point: [],
    pointShadow: [],
    pointShadowMap: [],
    pointShadowMatrix: [],
    hemi: []
  };
  for (let i = 0; i < 9; i++)
    state.probe.push(new Vector3());
  let vector3 = new Vector3(), matrix4 = new Matrix4(), matrix42 = new Matrix4();
  function setup(lights) {
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < 9; i++)
      state.probe[i].set(0, 0, 0);
    let directionalLength = 0, pointLength = 0, spotLength = 0, rectAreaLength = 0, hemiLength = 0, numDirectionalShadows = 0, numPointShadows = 0, numSpotShadows = 0;
    lights.sort(shadowCastingLightsFirst);
    for (let i = 0, l = lights.length; i < l; i++) {
      let light = lights[i], color = light.color, intensity = light.intensity, distance = light.distance, shadowMap = light.shadow && light.shadow.map ? light.shadow.map.texture : null;
      if (light.isAmbientLight)
        r += color.r * intensity, g += color.g * intensity, b += color.b * intensity;
      else if (light.isLightProbe)
        for (let j = 0; j < 9; j++)
          state.probe[j].addScaledVector(light.sh.coefficients[j], intensity);
      else if (light.isDirectionalLight) {
        let uniforms = cache.get(light);
        if (uniforms.color.copy(light.color).multiplyScalar(light.intensity), light.castShadow) {
          let shadow = light.shadow, shadowUniforms = shadowCache.get(light);
          shadowUniforms.shadowBias = shadow.bias, shadowUniforms.shadowNormalBias = shadow.normalBias, shadowUniforms.shadowRadius = shadow.radius, shadowUniforms.shadowMapSize = shadow.mapSize, state.directionalShadow[directionalLength] = shadowUniforms, state.directionalShadowMap[directionalLength] = shadowMap, state.directionalShadowMatrix[directionalLength] = light.shadow.matrix, numDirectionalShadows++;
        }
        state.directional[directionalLength] = uniforms, directionalLength++;
      } else if (light.isSpotLight) {
        let uniforms = cache.get(light);
        if (uniforms.position.setFromMatrixPosition(light.matrixWorld), uniforms.color.copy(color).multiplyScalar(intensity), uniforms.distance = distance, uniforms.coneCos = Math.cos(light.angle), uniforms.penumbraCos = Math.cos(light.angle * (1 - light.penumbra)), uniforms.decay = light.decay, light.castShadow) {
          let shadow = light.shadow, shadowUniforms = shadowCache.get(light);
          shadowUniforms.shadowBias = shadow.bias, shadowUniforms.shadowNormalBias = shadow.normalBias, shadowUniforms.shadowRadius = shadow.radius, shadowUniforms.shadowMapSize = shadow.mapSize, state.spotShadow[spotLength] = shadowUniforms, state.spotShadowMap[spotLength] = shadowMap, state.spotShadowMatrix[spotLength] = light.shadow.matrix, numSpotShadows++;
        }
        state.spot[spotLength] = uniforms, spotLength++;
      } else if (light.isRectAreaLight) {
        let uniforms = cache.get(light);
        uniforms.color.copy(color).multiplyScalar(intensity), uniforms.halfWidth.set(light.width * 0.5, 0, 0), uniforms.halfHeight.set(0, light.height * 0.5, 0), state.rectArea[rectAreaLength] = uniforms, rectAreaLength++;
      } else if (light.isPointLight) {
        let uniforms = cache.get(light);
        if (uniforms.color.copy(light.color).multiplyScalar(light.intensity), uniforms.distance = light.distance, uniforms.decay = light.decay, light.castShadow) {
          let shadow = light.shadow, shadowUniforms = shadowCache.get(light);
          shadowUniforms.shadowBias = shadow.bias, shadowUniforms.shadowNormalBias = shadow.normalBias, shadowUniforms.shadowRadius = shadow.radius, shadowUniforms.shadowMapSize = shadow.mapSize, shadowUniforms.shadowCameraNear = shadow.camera.near, shadowUniforms.shadowCameraFar = shadow.camera.far, state.pointShadow[pointLength] = shadowUniforms, state.pointShadowMap[pointLength] = shadowMap, state.pointShadowMatrix[pointLength] = light.shadow.matrix, numPointShadows++;
        }
        state.point[pointLength] = uniforms, pointLength++;
      } else if (light.isHemisphereLight) {
        let uniforms = cache.get(light);
        uniforms.skyColor.copy(light.color).multiplyScalar(intensity), uniforms.groundColor.copy(light.groundColor).multiplyScalar(intensity), state.hemi[hemiLength] = uniforms, hemiLength++;
      }
    }
    rectAreaLength > 0 && (capabilities.isWebGL2 || extensions.has("OES_texture_float_linear") === !0 ? (state.rectAreaLTC1 = UniformsLib.LTC_FLOAT_1, state.rectAreaLTC2 = UniformsLib.LTC_FLOAT_2) : extensions.has("OES_texture_half_float_linear") === !0 ? (state.rectAreaLTC1 = UniformsLib.LTC_HALF_1, state.rectAreaLTC2 = UniformsLib.LTC_HALF_2) : console.error("THREE.WebGLRenderer: Unable to use RectAreaLight. Missing WebGL extensions.")), state.ambient[0] = r, state.ambient[1] = g, state.ambient[2] = b;
    let hash = state.hash;
    (hash.directionalLength !== directionalLength || hash.pointLength !== pointLength || hash.spotLength !== spotLength || hash.rectAreaLength !== rectAreaLength || hash.hemiLength !== hemiLength || hash.numDirectionalShadows !== numDirectionalShadows || hash.numPointShadows !== numPointShadows || hash.numSpotShadows !== numSpotShadows) && (state.directional.length = directionalLength, state.spot.length = spotLength, state.rectArea.length = rectAreaLength, state.point.length = pointLength, state.hemi.length = hemiLength, state.directionalShadow.length = numDirectionalShadows, state.directionalShadowMap.length = numDirectionalShadows, state.pointShadow.length = numPointShadows, state.pointShadowMap.length = numPointShadows, state.spotShadow.length = numSpotShadows, state.spotShadowMap.length = numSpotShadows, state.directionalShadowMatrix.length = numDirectionalShadows, state.pointShadowMatrix.length = numPointShadows, state.spotShadowMatrix.length = numSpotShadows, hash.directionalLength = directionalLength, hash.pointLength = pointLength, hash.spotLength = spotLength, hash.rectAreaLength = rectAreaLength, hash.hemiLength = hemiLength, hash.numDirectionalShadows = numDirectionalShadows, hash.numPointShadows = numPointShadows, hash.numSpotShadows = numSpotShadows, state.version = nextVersion++);
  }
  function setupView(lights, camera) {
    let directionalLength = 0, pointLength = 0, spotLength = 0, rectAreaLength = 0, hemiLength = 0, viewMatrix = camera.matrixWorldInverse;
    for (let i = 0, l = lights.length; i < l; i++) {
      let light = lights[i];
      if (light.isDirectionalLight) {
        let uniforms = state.directional[directionalLength];
        uniforms.direction.setFromMatrixPosition(light.matrixWorld), vector3.setFromMatrixPosition(light.target.matrixWorld), uniforms.direction.sub(vector3), uniforms.direction.transformDirection(viewMatrix), directionalLength++;
      } else if (light.isSpotLight) {
        let uniforms = state.spot[spotLength];
        uniforms.position.setFromMatrixPosition(light.matrixWorld), uniforms.position.applyMatrix4(viewMatrix), uniforms.direction.setFromMatrixPosition(light.matrixWorld), vector3.setFromMatrixPosition(light.target.matrixWorld), uniforms.direction.sub(vector3), uniforms.direction.transformDirection(viewMatrix), spotLength++;
      } else if (light.isRectAreaLight) {
        let uniforms = state.rectArea[rectAreaLength];
        uniforms.position.setFromMatrixPosition(light.matrixWorld), uniforms.position.applyMatrix4(viewMatrix), matrix42.identity(), matrix4.copy(light.matrixWorld), matrix4.premultiply(viewMatrix), matrix42.extractRotation(matrix4), uniforms.halfWidth.set(light.width * 0.5, 0, 0), uniforms.halfHeight.set(0, light.height * 0.5, 0), uniforms.halfWidth.applyMatrix4(matrix42), uniforms.halfHeight.applyMatrix4(matrix42), rectAreaLength++;
      } else if (light.isPointLight) {
        let uniforms = state.point[pointLength];
        uniforms.position.setFromMatrixPosition(light.matrixWorld), uniforms.position.applyMatrix4(viewMatrix), pointLength++;
      } else if (light.isHemisphereLight) {
        let uniforms = state.hemi[hemiLength];
        uniforms.direction.setFromMatrixPosition(light.matrixWorld), uniforms.direction.transformDirection(viewMatrix), uniforms.direction.normalize(), hemiLength++;
      }
    }
  }
  return {
    setup,
    setupView,
    state
  };
}
function WebGLRenderState(extensions, capabilities) {
  let lights = new WebGLLights(extensions, capabilities), lightsArray = [], shadowsArray = [];
  function init() {
    lightsArray.length = 0, shadowsArray.length = 0;
  }
  function pushLight(light) {
    lightsArray.push(light);
  }
  function pushShadow(shadowLight) {
    shadowsArray.push(shadowLight);
  }
  function setupLights() {
    lights.setup(lightsArray);
  }
  function setupLightsView(camera) {
    lights.setupView(lightsArray, camera);
  }
  return {
    init,
    state: {
      lightsArray,
      shadowsArray,
      lights
    },
    setupLights,
    setupLightsView,
    pushLight,
    pushShadow
  };
}
function WebGLRenderStates(extensions, capabilities) {
  let renderStates = new WeakMap();
  function get(scene, renderCallDepth = 0) {
    let renderState;
    return renderStates.has(scene) === !1 ? (renderState = new WebGLRenderState(extensions, capabilities), renderStates.set(scene, [renderState])) : renderCallDepth >= renderStates.get(scene).length ? (renderState = new WebGLRenderState(extensions, capabilities), renderStates.get(scene).push(renderState)) : renderState = renderStates.get(scene)[renderCallDepth], renderState;
  }
  function dispose() {
    renderStates = new WeakMap();
  }
  return {
    get,
    dispose
  };
}
var MeshDepthMaterial = class extends Material {
  constructor(parameters) {
    super();
    this.type = "MeshDepthMaterial", this.depthPacking = BasicDepthPacking, this.morphTargets = !1, this.map = null, this.alphaMap = null, this.displacementMap = null, this.displacementScale = 1, this.displacementBias = 0, this.wireframe = !1, this.wireframeLinewidth = 1, this.fog = !1, this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.depthPacking = source.depthPacking, this.morphTargets = source.morphTargets, this.map = source.map, this.alphaMap = source.alphaMap, this.displacementMap = source.displacementMap, this.displacementScale = source.displacementScale, this.displacementBias = source.displacementBias, this.wireframe = source.wireframe, this.wireframeLinewidth = source.wireframeLinewidth, this;
  }
};
MeshDepthMaterial.prototype.isMeshDepthMaterial = !0;
var MeshDistanceMaterial = class extends Material {
  constructor(parameters) {
    super();
    this.type = "MeshDistanceMaterial", this.referencePosition = new Vector3(), this.nearDistance = 1, this.farDistance = 1e3, this.morphTargets = !1, this.map = null, this.alphaMap = null, this.displacementMap = null, this.displacementScale = 1, this.displacementBias = 0, this.fog = !1, this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.referencePosition.copy(source.referencePosition), this.nearDistance = source.nearDistance, this.farDistance = source.farDistance, this.morphTargets = source.morphTargets, this.map = source.map, this.alphaMap = source.alphaMap, this.displacementMap = source.displacementMap, this.displacementScale = source.displacementScale, this.displacementBias = source.displacementBias, this;
  }
};
MeshDistanceMaterial.prototype.isMeshDistanceMaterial = !0;
var vsm_frag = `uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	float mean = 0.0;
	float squared_mean = 0.0;
	float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy ) / resolution ) );
	for ( float i = -1.0; i < 1.0 ; i += SAMPLE_RATE) {
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( i, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, i ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean * HALF_SAMPLE_RATE;
	squared_mean = squared_mean * HALF_SAMPLE_RATE;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`, vsm_vert = `void main() {
	gl_Position = vec4( position, 1.0 );
}`;
function WebGLShadowMap(_renderer, _objects, _capabilities) {
  let _frustum = new Frustum(), _shadowMapSize = new Vector2(), _viewportSize = new Vector2(), _viewport = new Vector4(), _depthMaterials = [], _distanceMaterials = [], _materialCache = {}, _maxTextureSize = _capabilities.maxTextureSize, shadowSide = { 0: BackSide, 1: FrontSide, 2: DoubleSide }, shadowMaterialVertical = new ShaderMaterial({
    defines: {
      SAMPLE_RATE: 2 / 8,
      HALF_SAMPLE_RATE: 1 / 8
    },
    uniforms: {
      shadow_pass: { value: null },
      resolution: { value: new Vector2() },
      radius: { value: 4 }
    },
    vertexShader: vsm_vert,
    fragmentShader: vsm_frag
  }), shadowMaterialHorizontal = shadowMaterialVertical.clone();
  shadowMaterialHorizontal.defines.HORIZONTAL_PASS = 1;
  let fullScreenTri = new BufferGeometry();
  fullScreenTri.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0.5, 3, -1, 0.5, -1, 3, 0.5]), 3));
  let fullScreenMesh = new Mesh(fullScreenTri, shadowMaterialVertical), scope = this;
  this.enabled = !1, this.autoUpdate = !0, this.needsUpdate = !1, this.type = PCFShadowMap, this.render = function(lights, scene, camera) {
    if (scope.enabled === !1 || scope.autoUpdate === !1 && scope.needsUpdate === !1 || lights.length === 0)
      return;
    let currentRenderTarget = _renderer.getRenderTarget(), activeCubeFace = _renderer.getActiveCubeFace(), activeMipmapLevel = _renderer.getActiveMipmapLevel(), _state = _renderer.state;
    _state.setBlending(NoBlending), _state.buffers.color.setClear(1, 1, 1, 1), _state.buffers.depth.setTest(!0), _state.setScissorTest(!1);
    for (let i = 0, il = lights.length; i < il; i++) {
      let light = lights[i], shadow = light.shadow;
      if (shadow === void 0) {
        console.warn("THREE.WebGLShadowMap:", light, "has no shadow.");
        continue;
      }
      if (shadow.autoUpdate === !1 && shadow.needsUpdate === !1)
        continue;
      _shadowMapSize.copy(shadow.mapSize);
      let shadowFrameExtents = shadow.getFrameExtents();
      if (_shadowMapSize.multiply(shadowFrameExtents), _viewportSize.copy(shadow.mapSize), (_shadowMapSize.x > _maxTextureSize || _shadowMapSize.y > _maxTextureSize) && (_shadowMapSize.x > _maxTextureSize && (_viewportSize.x = Math.floor(_maxTextureSize / shadowFrameExtents.x), _shadowMapSize.x = _viewportSize.x * shadowFrameExtents.x, shadow.mapSize.x = _viewportSize.x), _shadowMapSize.y > _maxTextureSize && (_viewportSize.y = Math.floor(_maxTextureSize / shadowFrameExtents.y), _shadowMapSize.y = _viewportSize.y * shadowFrameExtents.y, shadow.mapSize.y = _viewportSize.y)), shadow.map === null && !shadow.isPointLightShadow && this.type === VSMShadowMap) {
        let pars = { minFilter: LinearFilter, magFilter: LinearFilter, format: RGBAFormat };
        shadow.map = new WebGLRenderTarget(_shadowMapSize.x, _shadowMapSize.y, pars), shadow.map.texture.name = light.name + ".shadowMap", shadow.mapPass = new WebGLRenderTarget(_shadowMapSize.x, _shadowMapSize.y, pars), shadow.camera.updateProjectionMatrix();
      }
      if (shadow.map === null) {
        let pars = { minFilter: NearestFilter, magFilter: NearestFilter, format: RGBAFormat };
        shadow.map = new WebGLRenderTarget(_shadowMapSize.x, _shadowMapSize.y, pars), shadow.map.texture.name = light.name + ".shadowMap", shadow.camera.updateProjectionMatrix();
      }
      _renderer.setRenderTarget(shadow.map), _renderer.clear();
      let viewportCount = shadow.getViewportCount();
      for (let vp = 0; vp < viewportCount; vp++) {
        let viewport = shadow.getViewport(vp);
        _viewport.set(_viewportSize.x * viewport.x, _viewportSize.y * viewport.y, _viewportSize.x * viewport.z, _viewportSize.y * viewport.w), _state.viewport(_viewport), shadow.updateMatrices(light, vp), _frustum = shadow.getFrustum(), renderObject(scene, camera, shadow.camera, light, this.type);
      }
      !shadow.isPointLightShadow && this.type === VSMShadowMap && VSMPass(shadow, camera), shadow.needsUpdate = !1;
    }
    scope.needsUpdate = !1, _renderer.setRenderTarget(currentRenderTarget, activeCubeFace, activeMipmapLevel);
  };
  function VSMPass(shadow, camera) {
    let geometry = _objects.update(fullScreenMesh);
    shadowMaterialVertical.uniforms.shadow_pass.value = shadow.map.texture, shadowMaterialVertical.uniforms.resolution.value = shadow.mapSize, shadowMaterialVertical.uniforms.radius.value = shadow.radius, _renderer.setRenderTarget(shadow.mapPass), _renderer.clear(), _renderer.renderBufferDirect(camera, null, geometry, shadowMaterialVertical, fullScreenMesh, null), shadowMaterialHorizontal.uniforms.shadow_pass.value = shadow.mapPass.texture, shadowMaterialHorizontal.uniforms.resolution.value = shadow.mapSize, shadowMaterialHorizontal.uniforms.radius.value = shadow.radius, _renderer.setRenderTarget(shadow.map), _renderer.clear(), _renderer.renderBufferDirect(camera, null, geometry, shadowMaterialHorizontal, fullScreenMesh, null);
  }
  function getDepthMaterialVariant(useMorphing) {
    let index = useMorphing << 0, material = _depthMaterials[index];
    return material === void 0 && (material = new MeshDepthMaterial({
      depthPacking: RGBADepthPacking,
      morphTargets: useMorphing
    }), _depthMaterials[index] = material), material;
  }
  function getDistanceMaterialVariant(useMorphing) {
    let index = useMorphing << 0, material = _distanceMaterials[index];
    return material === void 0 && (material = new MeshDistanceMaterial({
      morphTargets: useMorphing
    }), _distanceMaterials[index] = material), material;
  }
  function getDepthMaterial(object, geometry, material, light, shadowCameraNear, shadowCameraFar, type) {
    let result = null, getMaterialVariant = getDepthMaterialVariant, customMaterial = object.customDepthMaterial;
    if (light.isPointLight === !0 && (getMaterialVariant = getDistanceMaterialVariant, customMaterial = object.customDistanceMaterial), customMaterial === void 0) {
      let useMorphing = !1;
      material.morphTargets === !0 && (useMorphing = geometry.morphAttributes && geometry.morphAttributes.position && geometry.morphAttributes.position.length > 0), result = getMaterialVariant(useMorphing);
    } else
      result = customMaterial;
    if (_renderer.localClippingEnabled && material.clipShadows === !0 && material.clippingPlanes.length !== 0) {
      let keyA = result.uuid, keyB = material.uuid, materialsForVariant = _materialCache[keyA];
      materialsForVariant === void 0 && (materialsForVariant = {}, _materialCache[keyA] = materialsForVariant);
      let cachedMaterial = materialsForVariant[keyB];
      cachedMaterial === void 0 && (cachedMaterial = result.clone(), materialsForVariant[keyB] = cachedMaterial), result = cachedMaterial;
    }
    return result.visible = material.visible, result.wireframe = material.wireframe, type === VSMShadowMap ? result.side = material.shadowSide !== null ? material.shadowSide : material.side : result.side = material.shadowSide !== null ? material.shadowSide : shadowSide[material.side], result.clipShadows = material.clipShadows, result.clippingPlanes = material.clippingPlanes, result.clipIntersection = material.clipIntersection, result.wireframeLinewidth = material.wireframeLinewidth, result.linewidth = material.linewidth, light.isPointLight === !0 && result.isMeshDistanceMaterial === !0 && (result.referencePosition.setFromMatrixPosition(light.matrixWorld), result.nearDistance = shadowCameraNear, result.farDistance = shadowCameraFar), result;
  }
  function renderObject(object, camera, shadowCamera, light, type) {
    if (object.visible === !1)
      return;
    if (object.layers.test(camera.layers) && (object.isMesh || object.isLine || object.isPoints) && (object.castShadow || object.receiveShadow && type === VSMShadowMap) && (!object.frustumCulled || _frustum.intersectsObject(object))) {
      object.modelViewMatrix.multiplyMatrices(shadowCamera.matrixWorldInverse, object.matrixWorld);
      let geometry = _objects.update(object), material = object.material;
      if (Array.isArray(material)) {
        let groups = geometry.groups;
        for (let k = 0, kl = groups.length; k < kl; k++) {
          let group = groups[k], groupMaterial = material[group.materialIndex];
          if (groupMaterial && groupMaterial.visible) {
            let depthMaterial = getDepthMaterial(object, geometry, groupMaterial, light, shadowCamera.near, shadowCamera.far, type);
            _renderer.renderBufferDirect(shadowCamera, null, geometry, depthMaterial, object, group);
          }
        }
      } else if (material.visible) {
        let depthMaterial = getDepthMaterial(object, geometry, material, light, shadowCamera.near, shadowCamera.far, type);
        _renderer.renderBufferDirect(shadowCamera, null, geometry, depthMaterial, object, null);
      }
    }
    let children = object.children;
    for (let i = 0, l = children.length; i < l; i++)
      renderObject(children[i], camera, shadowCamera, light, type);
  }
}
function WebGLState(gl, extensions, capabilities) {
  let isWebGL2 = capabilities.isWebGL2;
  function ColorBuffer() {
    let locked = !1, color = new Vector4(), currentColorMask = null, currentColorClear = new Vector4(0, 0, 0, 0);
    return {
      setMask: function(colorMask) {
        currentColorMask !== colorMask && !locked && (gl.colorMask(colorMask, colorMask, colorMask, colorMask), currentColorMask = colorMask);
      },
      setLocked: function(lock) {
        locked = lock;
      },
      setClear: function(r, g, b, a, premultipliedAlpha) {
        premultipliedAlpha === !0 && (r *= a, g *= a, b *= a), color.set(r, g, b, a), currentColorClear.equals(color) === !1 && (gl.clearColor(r, g, b, a), currentColorClear.copy(color));
      },
      reset: function() {
        locked = !1, currentColorMask = null, currentColorClear.set(-1, 0, 0, 0);
      }
    };
  }
  function DepthBuffer() {
    let locked = !1, currentDepthMask = null, currentDepthFunc = null, currentDepthClear = null;
    return {
      setTest: function(depthTest) {
        depthTest ? enable(2929) : disable(2929);
      },
      setMask: function(depthMask) {
        currentDepthMask !== depthMask && !locked && (gl.depthMask(depthMask), currentDepthMask = depthMask);
      },
      setFunc: function(depthFunc) {
        if (currentDepthFunc !== depthFunc) {
          if (depthFunc)
            switch (depthFunc) {
              case NeverDepth:
                gl.depthFunc(512);
                break;
              case AlwaysDepth:
                gl.depthFunc(519);
                break;
              case LessDepth:
                gl.depthFunc(513);
                break;
              case LessEqualDepth:
                gl.depthFunc(515);
                break;
              case EqualDepth:
                gl.depthFunc(514);
                break;
              case GreaterEqualDepth:
                gl.depthFunc(518);
                break;
              case GreaterDepth:
                gl.depthFunc(516);
                break;
              case NotEqualDepth:
                gl.depthFunc(517);
                break;
              default:
                gl.depthFunc(515);
            }
          else
            gl.depthFunc(515);
          currentDepthFunc = depthFunc;
        }
      },
      setLocked: function(lock) {
        locked = lock;
      },
      setClear: function(depth) {
        currentDepthClear !== depth && (gl.clearDepth(depth), currentDepthClear = depth);
      },
      reset: function() {
        locked = !1, currentDepthMask = null, currentDepthFunc = null, currentDepthClear = null;
      }
    };
  }
  function StencilBuffer() {
    let locked = !1, currentStencilMask = null, currentStencilFunc = null, currentStencilRef = null, currentStencilFuncMask = null, currentStencilFail = null, currentStencilZFail = null, currentStencilZPass = null, currentStencilClear = null;
    return {
      setTest: function(stencilTest) {
        locked || (stencilTest ? enable(2960) : disable(2960));
      },
      setMask: function(stencilMask) {
        currentStencilMask !== stencilMask && !locked && (gl.stencilMask(stencilMask), currentStencilMask = stencilMask);
      },
      setFunc: function(stencilFunc, stencilRef, stencilMask) {
        (currentStencilFunc !== stencilFunc || currentStencilRef !== stencilRef || currentStencilFuncMask !== stencilMask) && (gl.stencilFunc(stencilFunc, stencilRef, stencilMask), currentStencilFunc = stencilFunc, currentStencilRef = stencilRef, currentStencilFuncMask = stencilMask);
      },
      setOp: function(stencilFail, stencilZFail, stencilZPass) {
        (currentStencilFail !== stencilFail || currentStencilZFail !== stencilZFail || currentStencilZPass !== stencilZPass) && (gl.stencilOp(stencilFail, stencilZFail, stencilZPass), currentStencilFail = stencilFail, currentStencilZFail = stencilZFail, currentStencilZPass = stencilZPass);
      },
      setLocked: function(lock) {
        locked = lock;
      },
      setClear: function(stencil) {
        currentStencilClear !== stencil && (gl.clearStencil(stencil), currentStencilClear = stencil);
      },
      reset: function() {
        locked = !1, currentStencilMask = null, currentStencilFunc = null, currentStencilRef = null, currentStencilFuncMask = null, currentStencilFail = null, currentStencilZFail = null, currentStencilZPass = null, currentStencilClear = null;
      }
    };
  }
  let colorBuffer = new ColorBuffer(), depthBuffer = new DepthBuffer(), stencilBuffer = new StencilBuffer(), enabledCapabilities = {}, xrFramebuffer = null, currentBoundFramebuffers = {}, currentProgram = null, currentBlendingEnabled = !1, currentBlending = null, currentBlendEquation = null, currentBlendSrc = null, currentBlendDst = null, currentBlendEquationAlpha = null, currentBlendSrcAlpha = null, currentBlendDstAlpha = null, currentPremultipledAlpha = !1, currentFlipSided = null, currentCullFace = null, currentLineWidth = null, currentPolygonOffsetFactor = null, currentPolygonOffsetUnits = null, maxTextures = gl.getParameter(35661), lineWidthAvailable = !1, version = 0, glVersion = gl.getParameter(7938);
  glVersion.indexOf("WebGL") !== -1 ? (version = parseFloat(/^WebGL (\d)/.exec(glVersion)[1]), lineWidthAvailable = version >= 1) : glVersion.indexOf("OpenGL ES") !== -1 && (version = parseFloat(/^OpenGL ES (\d)/.exec(glVersion)[1]), lineWidthAvailable = version >= 2);
  let currentTextureSlot = null, currentBoundTextures = {}, scissorParam = gl.getParameter(3088), viewportParam = gl.getParameter(2978), currentScissor = new Vector4().fromArray(scissorParam), currentViewport = new Vector4().fromArray(viewportParam);
  function createTexture(type, target, count) {
    let data = new Uint8Array(4), texture = gl.createTexture();
    gl.bindTexture(type, texture), gl.texParameteri(type, 10241, 9728), gl.texParameteri(type, 10240, 9728);
    for (let i = 0; i < count; i++)
      gl.texImage2D(target + i, 0, 6408, 1, 1, 0, 6408, 5121, data);
    return texture;
  }
  let emptyTextures = {};
  emptyTextures[3553] = createTexture(3553, 3553, 1), emptyTextures[34067] = createTexture(34067, 34069, 6), colorBuffer.setClear(0, 0, 0, 1), depthBuffer.setClear(1), stencilBuffer.setClear(0), enable(2929), depthBuffer.setFunc(LessEqualDepth), setFlipSided(!1), setCullFace(CullFaceBack), enable(2884), setBlending(NoBlending);
  function enable(id) {
    enabledCapabilities[id] !== !0 && (gl.enable(id), enabledCapabilities[id] = !0);
  }
  function disable(id) {
    enabledCapabilities[id] !== !1 && (gl.disable(id), enabledCapabilities[id] = !1);
  }
  function bindXRFramebuffer(framebuffer) {
    framebuffer !== xrFramebuffer && (gl.bindFramebuffer(36160, framebuffer), xrFramebuffer = framebuffer);
  }
  function bindFramebuffer(target, framebuffer) {
    return framebuffer === null && xrFramebuffer !== null && (framebuffer = xrFramebuffer), currentBoundFramebuffers[target] !== framebuffer ? (gl.bindFramebuffer(target, framebuffer), currentBoundFramebuffers[target] = framebuffer, isWebGL2 && (target === 36009 && (currentBoundFramebuffers[36160] = framebuffer), target === 36160 && (currentBoundFramebuffers[36009] = framebuffer)), !0) : !1;
  }
  function useProgram(program) {
    return currentProgram !== program ? (gl.useProgram(program), currentProgram = program, !0) : !1;
  }
  let equationToGL = {
    [AddEquation]: 32774,
    [SubtractEquation]: 32778,
    [ReverseSubtractEquation]: 32779
  };
  if (isWebGL2)
    equationToGL[MinEquation] = 32775, equationToGL[MaxEquation] = 32776;
  else {
    let extension = extensions.get("EXT_blend_minmax");
    extension !== null && (equationToGL[MinEquation] = extension.MIN_EXT, equationToGL[MaxEquation] = extension.MAX_EXT);
  }
  let factorToGL = {
    [ZeroFactor]: 0,
    [OneFactor]: 1,
    [SrcColorFactor]: 768,
    [SrcAlphaFactor]: 770,
    [SrcAlphaSaturateFactor]: 776,
    [DstColorFactor]: 774,
    [DstAlphaFactor]: 772,
    [OneMinusSrcColorFactor]: 769,
    [OneMinusSrcAlphaFactor]: 771,
    [OneMinusDstColorFactor]: 775,
    [OneMinusDstAlphaFactor]: 773
  };
  function setBlending(blending, blendEquation, blendSrc, blendDst, blendEquationAlpha, blendSrcAlpha, blendDstAlpha, premultipliedAlpha) {
    if (blending === NoBlending) {
      currentBlendingEnabled === !0 && (disable(3042), currentBlendingEnabled = !1);
      return;
    }
    if (currentBlendingEnabled === !1 && (enable(3042), currentBlendingEnabled = !0), blending !== CustomBlending) {
      if (blending !== currentBlending || premultipliedAlpha !== currentPremultipledAlpha) {
        if ((currentBlendEquation !== AddEquation || currentBlendEquationAlpha !== AddEquation) && (gl.blendEquation(32774), currentBlendEquation = AddEquation, currentBlendEquationAlpha = AddEquation), premultipliedAlpha)
          switch (blending) {
            case NormalBlending:
              gl.blendFuncSeparate(1, 771, 1, 771);
              break;
            case AdditiveBlending:
              gl.blendFunc(1, 1);
              break;
            case SubtractiveBlending:
              gl.blendFuncSeparate(0, 0, 769, 771);
              break;
            case MultiplyBlending:
              gl.blendFuncSeparate(0, 768, 0, 770);
              break;
            default:
              console.error("THREE.WebGLState: Invalid blending: ", blending);
              break;
          }
        else
          switch (blending) {
            case NormalBlending:
              gl.blendFuncSeparate(770, 771, 1, 771);
              break;
            case AdditiveBlending:
              gl.blendFunc(770, 1);
              break;
            case SubtractiveBlending:
              gl.blendFunc(0, 769);
              break;
            case MultiplyBlending:
              gl.blendFunc(0, 768);
              break;
            default:
              console.error("THREE.WebGLState: Invalid blending: ", blending);
              break;
          }
        currentBlendSrc = null, currentBlendDst = null, currentBlendSrcAlpha = null, currentBlendDstAlpha = null, currentBlending = blending, currentPremultipledAlpha = premultipliedAlpha;
      }
      return;
    }
    blendEquationAlpha = blendEquationAlpha || blendEquation, blendSrcAlpha = blendSrcAlpha || blendSrc, blendDstAlpha = blendDstAlpha || blendDst, (blendEquation !== currentBlendEquation || blendEquationAlpha !== currentBlendEquationAlpha) && (gl.blendEquationSeparate(equationToGL[blendEquation], equationToGL[blendEquationAlpha]), currentBlendEquation = blendEquation, currentBlendEquationAlpha = blendEquationAlpha), (blendSrc !== currentBlendSrc || blendDst !== currentBlendDst || blendSrcAlpha !== currentBlendSrcAlpha || blendDstAlpha !== currentBlendDstAlpha) && (gl.blendFuncSeparate(factorToGL[blendSrc], factorToGL[blendDst], factorToGL[blendSrcAlpha], factorToGL[blendDstAlpha]), currentBlendSrc = blendSrc, currentBlendDst = blendDst, currentBlendSrcAlpha = blendSrcAlpha, currentBlendDstAlpha = blendDstAlpha), currentBlending = blending, currentPremultipledAlpha = null;
  }
  function setMaterial(material, frontFaceCW) {
    material.side === DoubleSide ? disable(2884) : enable(2884);
    let flipSided = material.side === BackSide;
    frontFaceCW && (flipSided = !flipSided), setFlipSided(flipSided), material.blending === NormalBlending && material.transparent === !1 ? setBlending(NoBlending) : setBlending(material.blending, material.blendEquation, material.blendSrc, material.blendDst, material.blendEquationAlpha, material.blendSrcAlpha, material.blendDstAlpha, material.premultipliedAlpha), depthBuffer.setFunc(material.depthFunc), depthBuffer.setTest(material.depthTest), depthBuffer.setMask(material.depthWrite), colorBuffer.setMask(material.colorWrite);
    let stencilWrite = material.stencilWrite;
    stencilBuffer.setTest(stencilWrite), stencilWrite && (stencilBuffer.setMask(material.stencilWriteMask), stencilBuffer.setFunc(material.stencilFunc, material.stencilRef, material.stencilFuncMask), stencilBuffer.setOp(material.stencilFail, material.stencilZFail, material.stencilZPass)), setPolygonOffset(material.polygonOffset, material.polygonOffsetFactor, material.polygonOffsetUnits), material.alphaToCoverage === !0 ? enable(32926) : disable(32926);
  }
  function setFlipSided(flipSided) {
    currentFlipSided !== flipSided && (flipSided ? gl.frontFace(2304) : gl.frontFace(2305), currentFlipSided = flipSided);
  }
  function setCullFace(cullFace) {
    cullFace !== CullFaceNone ? (enable(2884), cullFace !== currentCullFace && (cullFace === CullFaceBack ? gl.cullFace(1029) : cullFace === CullFaceFront ? gl.cullFace(1028) : gl.cullFace(1032))) : disable(2884), currentCullFace = cullFace;
  }
  function setLineWidth(width) {
    width !== currentLineWidth && (lineWidthAvailable && gl.lineWidth(width), currentLineWidth = width);
  }
  function setPolygonOffset(polygonOffset, factor, units) {
    polygonOffset ? (enable(32823), (currentPolygonOffsetFactor !== factor || currentPolygonOffsetUnits !== units) && (gl.polygonOffset(factor, units), currentPolygonOffsetFactor = factor, currentPolygonOffsetUnits = units)) : disable(32823);
  }
  function setScissorTest(scissorTest) {
    scissorTest ? enable(3089) : disable(3089);
  }
  function activeTexture(webglSlot) {
    webglSlot === void 0 && (webglSlot = 33984 + maxTextures - 1), currentTextureSlot !== webglSlot && (gl.activeTexture(webglSlot), currentTextureSlot = webglSlot);
  }
  function bindTexture(webglType, webglTexture) {
    currentTextureSlot === null && activeTexture();
    let boundTexture = currentBoundTextures[currentTextureSlot];
    boundTexture === void 0 && (boundTexture = { type: void 0, texture: void 0 }, currentBoundTextures[currentTextureSlot] = boundTexture), (boundTexture.type !== webglType || boundTexture.texture !== webglTexture) && (gl.bindTexture(webglType, webglTexture || emptyTextures[webglType]), boundTexture.type = webglType, boundTexture.texture = webglTexture);
  }
  function unbindTexture() {
    let boundTexture = currentBoundTextures[currentTextureSlot];
    boundTexture !== void 0 && boundTexture.type !== void 0 && (gl.bindTexture(boundTexture.type, null), boundTexture.type = void 0, boundTexture.texture = void 0);
  }
  function compressedTexImage2D() {
    try {
      gl.compressedTexImage2D.apply(gl, arguments);
    } catch (error) {
      console.error("THREE.WebGLState:", error);
    }
  }
  function texImage2D() {
    try {
      gl.texImage2D.apply(gl, arguments);
    } catch (error) {
      console.error("THREE.WebGLState:", error);
    }
  }
  function texImage3D() {
    try {
      gl.texImage3D.apply(gl, arguments);
    } catch (error) {
      console.error("THREE.WebGLState:", error);
    }
  }
  function scissor(scissor2) {
    currentScissor.equals(scissor2) === !1 && (gl.scissor(scissor2.x, scissor2.y, scissor2.z, scissor2.w), currentScissor.copy(scissor2));
  }
  function viewport(viewport2) {
    currentViewport.equals(viewport2) === !1 && (gl.viewport(viewport2.x, viewport2.y, viewport2.z, viewport2.w), currentViewport.copy(viewport2));
  }
  function reset() {
    gl.disable(3042), gl.disable(2884), gl.disable(2929), gl.disable(32823), gl.disable(3089), gl.disable(2960), gl.disable(32926), gl.blendEquation(32774), gl.blendFunc(1, 0), gl.blendFuncSeparate(1, 0, 1, 0), gl.colorMask(!0, !0, !0, !0), gl.clearColor(0, 0, 0, 0), gl.depthMask(!0), gl.depthFunc(513), gl.clearDepth(1), gl.stencilMask(4294967295), gl.stencilFunc(519, 0, 4294967295), gl.stencilOp(7680, 7680, 7680), gl.clearStencil(0), gl.cullFace(1029), gl.frontFace(2305), gl.polygonOffset(0, 0), gl.activeTexture(33984), gl.bindFramebuffer(36160, null), isWebGL2 === !0 && (gl.bindFramebuffer(36009, null), gl.bindFramebuffer(36008, null)), gl.useProgram(null), gl.lineWidth(1), gl.scissor(0, 0, gl.canvas.width, gl.canvas.height), gl.viewport(0, 0, gl.canvas.width, gl.canvas.height), enabledCapabilities = {}, currentTextureSlot = null, currentBoundTextures = {}, xrFramebuffer = null, currentBoundFramebuffers = {}, currentProgram = null, currentBlendingEnabled = !1, currentBlending = null, currentBlendEquation = null, currentBlendSrc = null, currentBlendDst = null, currentBlendEquationAlpha = null, currentBlendSrcAlpha = null, currentBlendDstAlpha = null, currentPremultipledAlpha = !1, currentFlipSided = null, currentCullFace = null, currentLineWidth = null, currentPolygonOffsetFactor = null, currentPolygonOffsetUnits = null, currentScissor.set(0, 0, gl.canvas.width, gl.canvas.height), currentViewport.set(0, 0, gl.canvas.width, gl.canvas.height), colorBuffer.reset(), depthBuffer.reset(), stencilBuffer.reset();
  }
  return {
    buffers: {
      color: colorBuffer,
      depth: depthBuffer,
      stencil: stencilBuffer
    },
    enable,
    disable,
    bindFramebuffer,
    bindXRFramebuffer,
    useProgram,
    setBlending,
    setMaterial,
    setFlipSided,
    setCullFace,
    setLineWidth,
    setPolygonOffset,
    setScissorTest,
    activeTexture,
    bindTexture,
    unbindTexture,
    compressedTexImage2D,
    texImage2D,
    texImage3D,
    scissor,
    viewport,
    reset
  };
}
function WebGLTextures(_gl, extensions, state, properties, capabilities, utils, info) {
  let isWebGL2 = capabilities.isWebGL2, maxTextures = capabilities.maxTextures, maxCubemapSize = capabilities.maxCubemapSize, maxTextureSize = capabilities.maxTextureSize, maxSamples = capabilities.maxSamples, _videoTextures = new WeakMap(), _canvas2, useOffscreenCanvas = !1;
  try {
    useOffscreenCanvas = typeof OffscreenCanvas != "undefined" && new OffscreenCanvas(1, 1).getContext("2d") !== null;
  } catch (err) {
  }
  function createCanvas(width, height) {
    return useOffscreenCanvas ? new OffscreenCanvas(width, height) : document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  }
  function resizeImage(image, needsPowerOfTwo, needsNewCanvas, maxSize) {
    let scale = 1;
    if ((image.width > maxSize || image.height > maxSize) && (scale = maxSize / Math.max(image.width, image.height)), scale < 1 || needsPowerOfTwo === !0)
      if (typeof HTMLImageElement != "undefined" && image instanceof HTMLImageElement || typeof HTMLCanvasElement != "undefined" && image instanceof HTMLCanvasElement || typeof ImageBitmap != "undefined" && image instanceof ImageBitmap) {
        let floor = needsPowerOfTwo ? floorPowerOfTwo : Math.floor, width = floor(scale * image.width), height = floor(scale * image.height);
        _canvas2 === void 0 && (_canvas2 = createCanvas(width, height));
        let canvas = needsNewCanvas ? createCanvas(width, height) : _canvas2;
        return canvas.width = width, canvas.height = height, canvas.getContext("2d").drawImage(image, 0, 0, width, height), console.warn("THREE.WebGLRenderer: Texture has been resized from (" + image.width + "x" + image.height + ") to (" + width + "x" + height + ")."), canvas;
      } else
        return "data" in image && console.warn("THREE.WebGLRenderer: Image in DataTexture is too big (" + image.width + "x" + image.height + ")."), image;
    return image;
  }
  function isPowerOfTwo$1(image) {
    return isPowerOfTwo(image.width) && isPowerOfTwo(image.height);
  }
  function textureNeedsPowerOfTwo(texture) {
    return isWebGL2 ? !1 : texture.wrapS !== ClampToEdgeWrapping || texture.wrapT !== ClampToEdgeWrapping || texture.minFilter !== NearestFilter && texture.minFilter !== LinearFilter;
  }
  function textureNeedsGenerateMipmaps(texture, supportsMips) {
    return texture.generateMipmaps && supportsMips && texture.minFilter !== NearestFilter && texture.minFilter !== LinearFilter;
  }
  function generateMipmap(target, texture, width, height) {
    _gl.generateMipmap(target);
    let textureProperties = properties.get(texture);
    textureProperties.__maxMipLevel = Math.log2(Math.max(width, height));
  }
  function getInternalFormat(internalFormatName, glFormat, glType) {
    if (isWebGL2 === !1)
      return glFormat;
    if (internalFormatName !== null) {
      if (_gl[internalFormatName] !== void 0)
        return _gl[internalFormatName];
      console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '" + internalFormatName + "'");
    }
    let internalFormat = glFormat;
    return glFormat === 6403 && (glType === 5126 && (internalFormat = 33326), glType === 5131 && (internalFormat = 33325), glType === 5121 && (internalFormat = 33321)), glFormat === 6407 && (glType === 5126 && (internalFormat = 34837), glType === 5131 && (internalFormat = 34843), glType === 5121 && (internalFormat = 32849)), glFormat === 6408 && (glType === 5126 && (internalFormat = 34836), glType === 5131 && (internalFormat = 34842), glType === 5121 && (internalFormat = 32856)), (internalFormat === 33325 || internalFormat === 33326 || internalFormat === 34842 || internalFormat === 34836) && extensions.get("EXT_color_buffer_float"), internalFormat;
  }
  function filterFallback(f) {
    return f === NearestFilter || f === NearestMipmapNearestFilter || f === NearestMipmapLinearFilter ? 9728 : 9729;
  }
  function onTextureDispose(event) {
    let texture = event.target;
    texture.removeEventListener("dispose", onTextureDispose), deallocateTexture(texture), texture.isVideoTexture && _videoTextures.delete(texture), info.memory.textures--;
  }
  function onRenderTargetDispose(event) {
    let renderTarget = event.target;
    renderTarget.removeEventListener("dispose", onRenderTargetDispose), deallocateRenderTarget(renderTarget);
  }
  function deallocateTexture(texture) {
    let textureProperties = properties.get(texture);
    textureProperties.__webglInit !== void 0 && (_gl.deleteTexture(textureProperties.__webglTexture), properties.remove(texture));
  }
  function deallocateRenderTarget(renderTarget) {
    let texture = renderTarget.texture, renderTargetProperties = properties.get(renderTarget), textureProperties = properties.get(texture);
    if (!!renderTarget) {
      if (textureProperties.__webglTexture !== void 0 && (_gl.deleteTexture(textureProperties.__webglTexture), info.memory.textures--), renderTarget.depthTexture && renderTarget.depthTexture.dispose(), renderTarget.isWebGLCubeRenderTarget)
        for (let i = 0; i < 6; i++)
          _gl.deleteFramebuffer(renderTargetProperties.__webglFramebuffer[i]), renderTargetProperties.__webglDepthbuffer && _gl.deleteRenderbuffer(renderTargetProperties.__webglDepthbuffer[i]);
      else
        _gl.deleteFramebuffer(renderTargetProperties.__webglFramebuffer), renderTargetProperties.__webglDepthbuffer && _gl.deleteRenderbuffer(renderTargetProperties.__webglDepthbuffer), renderTargetProperties.__webglMultisampledFramebuffer && _gl.deleteFramebuffer(renderTargetProperties.__webglMultisampledFramebuffer), renderTargetProperties.__webglColorRenderbuffer && _gl.deleteRenderbuffer(renderTargetProperties.__webglColorRenderbuffer), renderTargetProperties.__webglDepthRenderbuffer && _gl.deleteRenderbuffer(renderTargetProperties.__webglDepthRenderbuffer);
      if (renderTarget.isWebGLMultipleRenderTargets)
        for (let i = 0, il = texture.length; i < il; i++) {
          let attachmentProperties = properties.get(texture[i]);
          attachmentProperties.__webglTexture && (_gl.deleteTexture(attachmentProperties.__webglTexture), info.memory.textures--), properties.remove(texture[i]);
        }
      properties.remove(texture), properties.remove(renderTarget);
    }
  }
  let textureUnits = 0;
  function resetTextureUnits() {
    textureUnits = 0;
  }
  function allocateTextureUnit() {
    let textureUnit = textureUnits;
    return textureUnit >= maxTextures && console.warn("THREE.WebGLTextures: Trying to use " + textureUnit + " texture units while this GPU supports only " + maxTextures), textureUnits += 1, textureUnit;
  }
  function setTexture2D(texture, slot) {
    let textureProperties = properties.get(texture);
    if (texture.isVideoTexture && updateVideoTexture(texture), texture.version > 0 && textureProperties.__version !== texture.version) {
      let image = texture.image;
      if (image === void 0)
        console.warn("THREE.WebGLRenderer: Texture marked for update but image is undefined");
      else if (image.complete === !1)
        console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");
      else {
        uploadTexture(textureProperties, texture, slot);
        return;
      }
    }
    state.activeTexture(33984 + slot), state.bindTexture(3553, textureProperties.__webglTexture);
  }
  function setTexture2DArray(texture, slot) {
    let textureProperties = properties.get(texture);
    if (texture.version > 0 && textureProperties.__version !== texture.version) {
      uploadTexture(textureProperties, texture, slot);
      return;
    }
    state.activeTexture(33984 + slot), state.bindTexture(35866, textureProperties.__webglTexture);
  }
  function setTexture3D(texture, slot) {
    let textureProperties = properties.get(texture);
    if (texture.version > 0 && textureProperties.__version !== texture.version) {
      uploadTexture(textureProperties, texture, slot);
      return;
    }
    state.activeTexture(33984 + slot), state.bindTexture(32879, textureProperties.__webglTexture);
  }
  function setTextureCube(texture, slot) {
    let textureProperties = properties.get(texture);
    if (texture.version > 0 && textureProperties.__version !== texture.version) {
      uploadCubeTexture(textureProperties, texture, slot);
      return;
    }
    state.activeTexture(33984 + slot), state.bindTexture(34067, textureProperties.__webglTexture);
  }
  let wrappingToGL = {
    [RepeatWrapping]: 10497,
    [ClampToEdgeWrapping]: 33071,
    [MirroredRepeatWrapping]: 33648
  }, filterToGL = {
    [NearestFilter]: 9728,
    [NearestMipmapNearestFilter]: 9984,
    [NearestMipmapLinearFilter]: 9986,
    [LinearFilter]: 9729,
    [LinearMipmapNearestFilter]: 9985,
    [LinearMipmapLinearFilter]: 9987
  };
  function setTextureParameters(textureType, texture, supportsMips) {
    if (supportsMips ? (_gl.texParameteri(textureType, 10242, wrappingToGL[texture.wrapS]), _gl.texParameteri(textureType, 10243, wrappingToGL[texture.wrapT]), (textureType === 32879 || textureType === 35866) && _gl.texParameteri(textureType, 32882, wrappingToGL[texture.wrapR]), _gl.texParameteri(textureType, 10240, filterToGL[texture.magFilter]), _gl.texParameteri(textureType, 10241, filterToGL[texture.minFilter])) : (_gl.texParameteri(textureType, 10242, 33071), _gl.texParameteri(textureType, 10243, 33071), (textureType === 32879 || textureType === 35866) && _gl.texParameteri(textureType, 32882, 33071), (texture.wrapS !== ClampToEdgeWrapping || texture.wrapT !== ClampToEdgeWrapping) && console.warn("THREE.WebGLRenderer: Texture is not power of two. Texture.wrapS and Texture.wrapT should be set to THREE.ClampToEdgeWrapping."), _gl.texParameteri(textureType, 10240, filterFallback(texture.magFilter)), _gl.texParameteri(textureType, 10241, filterFallback(texture.minFilter)), texture.minFilter !== NearestFilter && texture.minFilter !== LinearFilter && console.warn("THREE.WebGLRenderer: Texture is not power of two. Texture.minFilter should be set to THREE.NearestFilter or THREE.LinearFilter.")), extensions.has("EXT_texture_filter_anisotropic") === !0) {
      let extension = extensions.get("EXT_texture_filter_anisotropic");
      if (texture.type === FloatType && extensions.has("OES_texture_float_linear") === !1 || isWebGL2 === !1 && texture.type === HalfFloatType && extensions.has("OES_texture_half_float_linear") === !1)
        return;
      (texture.anisotropy > 1 || properties.get(texture).__currentAnisotropy) && (_gl.texParameterf(textureType, extension.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(texture.anisotropy, capabilities.getMaxAnisotropy())), properties.get(texture).__currentAnisotropy = texture.anisotropy);
    }
  }
  function initTexture(textureProperties, texture) {
    textureProperties.__webglInit === void 0 && (textureProperties.__webglInit = !0, texture.addEventListener("dispose", onTextureDispose), textureProperties.__webglTexture = _gl.createTexture(), info.memory.textures++);
  }
  function uploadTexture(textureProperties, texture, slot) {
    let textureType = 3553;
    texture.isDataTexture2DArray && (textureType = 35866), texture.isDataTexture3D && (textureType = 32879), initTexture(textureProperties, texture), state.activeTexture(33984 + slot), state.bindTexture(textureType, textureProperties.__webglTexture), _gl.pixelStorei(37440, texture.flipY), _gl.pixelStorei(37441, texture.premultiplyAlpha), _gl.pixelStorei(3317, texture.unpackAlignment), _gl.pixelStorei(37443, 0);
    let needsPowerOfTwo = textureNeedsPowerOfTwo(texture) && isPowerOfTwo$1(texture.image) === !1, image = resizeImage(texture.image, needsPowerOfTwo, !1, maxTextureSize), supportsMips = isPowerOfTwo$1(image) || isWebGL2, glFormat = utils.convert(texture.format), glType = utils.convert(texture.type), glInternalFormat = getInternalFormat(texture.internalFormat, glFormat, glType);
    setTextureParameters(textureType, texture, supportsMips);
    let mipmap, mipmaps = texture.mipmaps;
    if (texture.isDepthTexture)
      glInternalFormat = 6402, isWebGL2 ? texture.type === FloatType ? glInternalFormat = 36012 : texture.type === UnsignedIntType ? glInternalFormat = 33190 : texture.type === UnsignedInt248Type ? glInternalFormat = 35056 : glInternalFormat = 33189 : texture.type === FloatType && console.error("WebGLRenderer: Floating point depth texture requires WebGL2."), texture.format === DepthFormat && glInternalFormat === 6402 && texture.type !== UnsignedShortType && texture.type !== UnsignedIntType && (console.warn("THREE.WebGLRenderer: Use UnsignedShortType or UnsignedIntType for DepthFormat DepthTexture."), texture.type = UnsignedShortType, glType = utils.convert(texture.type)), texture.format === DepthStencilFormat && glInternalFormat === 6402 && (glInternalFormat = 34041, texture.type !== UnsignedInt248Type && (console.warn("THREE.WebGLRenderer: Use UnsignedInt248Type for DepthStencilFormat DepthTexture."), texture.type = UnsignedInt248Type, glType = utils.convert(texture.type))), state.texImage2D(3553, 0, glInternalFormat, image.width, image.height, 0, glFormat, glType, null);
    else if (texture.isDataTexture)
      if (mipmaps.length > 0 && supportsMips) {
        for (let i = 0, il = mipmaps.length; i < il; i++)
          mipmap = mipmaps[i], state.texImage2D(3553, i, glInternalFormat, mipmap.width, mipmap.height, 0, glFormat, glType, mipmap.data);
        texture.generateMipmaps = !1, textureProperties.__maxMipLevel = mipmaps.length - 1;
      } else
        state.texImage2D(3553, 0, glInternalFormat, image.width, image.height, 0, glFormat, glType, image.data), textureProperties.__maxMipLevel = 0;
    else if (texture.isCompressedTexture) {
      for (let i = 0, il = mipmaps.length; i < il; i++)
        mipmap = mipmaps[i], texture.format !== RGBAFormat && texture.format !== RGBFormat ? glFormat !== null ? state.compressedTexImage2D(3553, i, glInternalFormat, mipmap.width, mipmap.height, 0, mipmap.data) : console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()") : state.texImage2D(3553, i, glInternalFormat, mipmap.width, mipmap.height, 0, glFormat, glType, mipmap.data);
      textureProperties.__maxMipLevel = mipmaps.length - 1;
    } else if (texture.isDataTexture2DArray)
      state.texImage3D(35866, 0, glInternalFormat, image.width, image.height, image.depth, 0, glFormat, glType, image.data), textureProperties.__maxMipLevel = 0;
    else if (texture.isDataTexture3D)
      state.texImage3D(32879, 0, glInternalFormat, image.width, image.height, image.depth, 0, glFormat, glType, image.data), textureProperties.__maxMipLevel = 0;
    else if (mipmaps.length > 0 && supportsMips) {
      for (let i = 0, il = mipmaps.length; i < il; i++)
        mipmap = mipmaps[i], state.texImage2D(3553, i, glInternalFormat, glFormat, glType, mipmap);
      texture.generateMipmaps = !1, textureProperties.__maxMipLevel = mipmaps.length - 1;
    } else
      state.texImage2D(3553, 0, glInternalFormat, glFormat, glType, image), textureProperties.__maxMipLevel = 0;
    textureNeedsGenerateMipmaps(texture, supportsMips) && generateMipmap(textureType, texture, image.width, image.height), textureProperties.__version = texture.version, texture.onUpdate && texture.onUpdate(texture);
  }
  function uploadCubeTexture(textureProperties, texture, slot) {
    if (texture.image.length !== 6)
      return;
    initTexture(textureProperties, texture), state.activeTexture(33984 + slot), state.bindTexture(34067, textureProperties.__webglTexture), _gl.pixelStorei(37440, texture.flipY), _gl.pixelStorei(37441, texture.premultiplyAlpha), _gl.pixelStorei(3317, texture.unpackAlignment), _gl.pixelStorei(37443, 0);
    let isCompressed = texture && (texture.isCompressedTexture || texture.image[0].isCompressedTexture), isDataTexture = texture.image[0] && texture.image[0].isDataTexture, cubeImage = [];
    for (let i = 0; i < 6; i++)
      !isCompressed && !isDataTexture ? cubeImage[i] = resizeImage(texture.image[i], !1, !0, maxCubemapSize) : cubeImage[i] = isDataTexture ? texture.image[i].image : texture.image[i];
    let image = cubeImage[0], supportsMips = isPowerOfTwo$1(image) || isWebGL2, glFormat = utils.convert(texture.format), glType = utils.convert(texture.type), glInternalFormat = getInternalFormat(texture.internalFormat, glFormat, glType);
    setTextureParameters(34067, texture, supportsMips);
    let mipmaps;
    if (isCompressed) {
      for (let i = 0; i < 6; i++) {
        mipmaps = cubeImage[i].mipmaps;
        for (let j = 0; j < mipmaps.length; j++) {
          let mipmap = mipmaps[j];
          texture.format !== RGBAFormat && texture.format !== RGBFormat ? glFormat !== null ? state.compressedTexImage2D(34069 + i, j, glInternalFormat, mipmap.width, mipmap.height, 0, mipmap.data) : console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()") : state.texImage2D(34069 + i, j, glInternalFormat, mipmap.width, mipmap.height, 0, glFormat, glType, mipmap.data);
        }
      }
      textureProperties.__maxMipLevel = mipmaps.length - 1;
    } else {
      mipmaps = texture.mipmaps;
      for (let i = 0; i < 6; i++)
        if (isDataTexture) {
          state.texImage2D(34069 + i, 0, glInternalFormat, cubeImage[i].width, cubeImage[i].height, 0, glFormat, glType, cubeImage[i].data);
          for (let j = 0; j < mipmaps.length; j++) {
            let mipmapImage = mipmaps[j].image[i].image;
            state.texImage2D(34069 + i, j + 1, glInternalFormat, mipmapImage.width, mipmapImage.height, 0, glFormat, glType, mipmapImage.data);
          }
        } else {
          state.texImage2D(34069 + i, 0, glInternalFormat, glFormat, glType, cubeImage[i]);
          for (let j = 0; j < mipmaps.length; j++) {
            let mipmap = mipmaps[j];
            state.texImage2D(34069 + i, j + 1, glInternalFormat, glFormat, glType, mipmap.image[i]);
          }
        }
      textureProperties.__maxMipLevel = mipmaps.length;
    }
    textureNeedsGenerateMipmaps(texture, supportsMips) && generateMipmap(34067, texture, image.width, image.height), textureProperties.__version = texture.version, texture.onUpdate && texture.onUpdate(texture);
  }
  function setupFrameBufferTexture(framebuffer, renderTarget, texture, attachment, textureTarget) {
    let glFormat = utils.convert(texture.format), glType = utils.convert(texture.type), glInternalFormat = getInternalFormat(texture.internalFormat, glFormat, glType);
    textureTarget === 32879 || textureTarget === 35866 ? state.texImage3D(textureTarget, 0, glInternalFormat, renderTarget.width, renderTarget.height, renderTarget.depth, 0, glFormat, glType, null) : state.texImage2D(textureTarget, 0, glInternalFormat, renderTarget.width, renderTarget.height, 0, glFormat, glType, null), state.bindFramebuffer(36160, framebuffer), _gl.framebufferTexture2D(36160, attachment, textureTarget, properties.get(texture).__webglTexture, 0), state.bindFramebuffer(36160, null);
  }
  function setupRenderBufferStorage(renderbuffer, renderTarget, isMultisample) {
    if (_gl.bindRenderbuffer(36161, renderbuffer), renderTarget.depthBuffer && !renderTarget.stencilBuffer) {
      let glInternalFormat = 33189;
      if (isMultisample) {
        let depthTexture = renderTarget.depthTexture;
        depthTexture && depthTexture.isDepthTexture && (depthTexture.type === FloatType ? glInternalFormat = 36012 : depthTexture.type === UnsignedIntType && (glInternalFormat = 33190));
        let samples = getRenderTargetSamples(renderTarget);
        _gl.renderbufferStorageMultisample(36161, samples, glInternalFormat, renderTarget.width, renderTarget.height);
      } else
        _gl.renderbufferStorage(36161, glInternalFormat, renderTarget.width, renderTarget.height);
      _gl.framebufferRenderbuffer(36160, 36096, 36161, renderbuffer);
    } else if (renderTarget.depthBuffer && renderTarget.stencilBuffer) {
      if (isMultisample) {
        let samples = getRenderTargetSamples(renderTarget);
        _gl.renderbufferStorageMultisample(36161, samples, 35056, renderTarget.width, renderTarget.height);
      } else
        _gl.renderbufferStorage(36161, 34041, renderTarget.width, renderTarget.height);
      _gl.framebufferRenderbuffer(36160, 33306, 36161, renderbuffer);
    } else {
      let texture = renderTarget.isWebGLMultipleRenderTargets === !0 ? renderTarget.texture[0] : renderTarget.texture, glFormat = utils.convert(texture.format), glType = utils.convert(texture.type), glInternalFormat = getInternalFormat(texture.internalFormat, glFormat, glType);
      if (isMultisample) {
        let samples = getRenderTargetSamples(renderTarget);
        _gl.renderbufferStorageMultisample(36161, samples, glInternalFormat, renderTarget.width, renderTarget.height);
      } else
        _gl.renderbufferStorage(36161, glInternalFormat, renderTarget.width, renderTarget.height);
    }
    _gl.bindRenderbuffer(36161, null);
  }
  function setupDepthTexture(framebuffer, renderTarget) {
    if (renderTarget && renderTarget.isWebGLCubeRenderTarget)
      throw new Error("Depth Texture with cube render targets is not supported");
    if (state.bindFramebuffer(36160, framebuffer), !(renderTarget.depthTexture && renderTarget.depthTexture.isDepthTexture))
      throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");
    (!properties.get(renderTarget.depthTexture).__webglTexture || renderTarget.depthTexture.image.width !== renderTarget.width || renderTarget.depthTexture.image.height !== renderTarget.height) && (renderTarget.depthTexture.image.width = renderTarget.width, renderTarget.depthTexture.image.height = renderTarget.height, renderTarget.depthTexture.needsUpdate = !0), setTexture2D(renderTarget.depthTexture, 0);
    let webglDepthTexture = properties.get(renderTarget.depthTexture).__webglTexture;
    if (renderTarget.depthTexture.format === DepthFormat)
      _gl.framebufferTexture2D(36160, 36096, 3553, webglDepthTexture, 0);
    else if (renderTarget.depthTexture.format === DepthStencilFormat)
      _gl.framebufferTexture2D(36160, 33306, 3553, webglDepthTexture, 0);
    else
      throw new Error("Unknown depthTexture format");
  }
  function setupDepthRenderbuffer(renderTarget) {
    let renderTargetProperties = properties.get(renderTarget), isCube = renderTarget.isWebGLCubeRenderTarget === !0;
    if (renderTarget.depthTexture) {
      if (isCube)
        throw new Error("target.depthTexture not supported in Cube render targets");
      setupDepthTexture(renderTargetProperties.__webglFramebuffer, renderTarget);
    } else if (isCube) {
      renderTargetProperties.__webglDepthbuffer = [];
      for (let i = 0; i < 6; i++)
        state.bindFramebuffer(36160, renderTargetProperties.__webglFramebuffer[i]), renderTargetProperties.__webglDepthbuffer[i] = _gl.createRenderbuffer(), setupRenderBufferStorage(renderTargetProperties.__webglDepthbuffer[i], renderTarget, !1);
    } else
      state.bindFramebuffer(36160, renderTargetProperties.__webglFramebuffer), renderTargetProperties.__webglDepthbuffer = _gl.createRenderbuffer(), setupRenderBufferStorage(renderTargetProperties.__webglDepthbuffer, renderTarget, !1);
    state.bindFramebuffer(36160, null);
  }
  function setupRenderTarget(renderTarget) {
    let texture = renderTarget.texture, renderTargetProperties = properties.get(renderTarget), textureProperties = properties.get(texture);
    renderTarget.addEventListener("dispose", onRenderTargetDispose), renderTarget.isWebGLMultipleRenderTargets !== !0 && (textureProperties.__webglTexture = _gl.createTexture(), textureProperties.__version = texture.version, info.memory.textures++);
    let isCube = renderTarget.isWebGLCubeRenderTarget === !0, isMultipleRenderTargets = renderTarget.isWebGLMultipleRenderTargets === !0, isMultisample = renderTarget.isWebGLMultisampleRenderTarget === !0, isRenderTarget3D = texture.isDataTexture3D || texture.isDataTexture2DArray, supportsMips = isPowerOfTwo$1(renderTarget) || isWebGL2;
    if (isWebGL2 && texture.format === RGBFormat && (texture.type === FloatType || texture.type === HalfFloatType) && (texture.format = RGBAFormat, console.warn("THREE.WebGLRenderer: Rendering to textures with RGB format is not supported. Using RGBA format instead.")), isCube) {
      renderTargetProperties.__webglFramebuffer = [];
      for (let i = 0; i < 6; i++)
        renderTargetProperties.__webglFramebuffer[i] = _gl.createFramebuffer();
    } else if (renderTargetProperties.__webglFramebuffer = _gl.createFramebuffer(), isMultipleRenderTargets)
      if (capabilities.drawBuffers) {
        let textures = renderTarget.texture;
        for (let i = 0, il = textures.length; i < il; i++) {
          let attachmentProperties = properties.get(textures[i]);
          attachmentProperties.__webglTexture === void 0 && (attachmentProperties.__webglTexture = _gl.createTexture(), info.memory.textures++);
        }
      } else
        console.warn("THREE.WebGLRenderer: WebGLMultipleRenderTargets can only be used with WebGL2 or WEBGL_draw_buffers extension.");
    else if (isMultisample)
      if (isWebGL2) {
        renderTargetProperties.__webglMultisampledFramebuffer = _gl.createFramebuffer(), renderTargetProperties.__webglColorRenderbuffer = _gl.createRenderbuffer(), _gl.bindRenderbuffer(36161, renderTargetProperties.__webglColorRenderbuffer);
        let glFormat = utils.convert(texture.format), glType = utils.convert(texture.type), glInternalFormat = getInternalFormat(texture.internalFormat, glFormat, glType), samples = getRenderTargetSamples(renderTarget);
        _gl.renderbufferStorageMultisample(36161, samples, glInternalFormat, renderTarget.width, renderTarget.height), state.bindFramebuffer(36160, renderTargetProperties.__webglMultisampledFramebuffer), _gl.framebufferRenderbuffer(36160, 36064, 36161, renderTargetProperties.__webglColorRenderbuffer), _gl.bindRenderbuffer(36161, null), renderTarget.depthBuffer && (renderTargetProperties.__webglDepthRenderbuffer = _gl.createRenderbuffer(), setupRenderBufferStorage(renderTargetProperties.__webglDepthRenderbuffer, renderTarget, !0)), state.bindFramebuffer(36160, null);
      } else
        console.warn("THREE.WebGLRenderer: WebGLMultisampleRenderTarget can only be used with WebGL2.");
    if (isCube) {
      state.bindTexture(34067, textureProperties.__webglTexture), setTextureParameters(34067, texture, supportsMips);
      for (let i = 0; i < 6; i++)
        setupFrameBufferTexture(renderTargetProperties.__webglFramebuffer[i], renderTarget, texture, 36064, 34069 + i);
      textureNeedsGenerateMipmaps(texture, supportsMips) && generateMipmap(34067, texture, renderTarget.width, renderTarget.height), state.bindTexture(34067, null);
    } else if (isMultipleRenderTargets) {
      let textures = renderTarget.texture;
      for (let i = 0, il = textures.length; i < il; i++) {
        let attachment = textures[i], attachmentProperties = properties.get(attachment);
        state.bindTexture(3553, attachmentProperties.__webglTexture), setTextureParameters(3553, attachment, supportsMips), setupFrameBufferTexture(renderTargetProperties.__webglFramebuffer, renderTarget, attachment, 36064 + i, 3553), textureNeedsGenerateMipmaps(attachment, supportsMips) && generateMipmap(3553, attachment, renderTarget.width, renderTarget.height);
      }
      state.bindTexture(3553, null);
    } else {
      let glTextureType = 3553;
      isRenderTarget3D && (isWebGL2 ? glTextureType = texture.isDataTexture3D ? 32879 : 35866 : console.warn("THREE.DataTexture3D and THREE.DataTexture2DArray only supported with WebGL2.")), state.bindTexture(glTextureType, textureProperties.__webglTexture), setTextureParameters(glTextureType, texture, supportsMips), setupFrameBufferTexture(renderTargetProperties.__webglFramebuffer, renderTarget, texture, 36064, glTextureType), textureNeedsGenerateMipmaps(texture, supportsMips) && generateMipmap(3553, texture, renderTarget.width, renderTarget.height), state.bindTexture(3553, null);
    }
    renderTarget.depthBuffer && setupDepthRenderbuffer(renderTarget);
  }
  function updateRenderTargetMipmap(renderTarget) {
    let supportsMips = isPowerOfTwo$1(renderTarget) || isWebGL2, textures = renderTarget.isWebGLMultipleRenderTargets === !0 ? renderTarget.texture : [renderTarget.texture];
    for (let i = 0, il = textures.length; i < il; i++) {
      let texture = textures[i];
      if (textureNeedsGenerateMipmaps(texture, supportsMips)) {
        let target = renderTarget.isWebGLCubeRenderTarget ? 34067 : 3553, webglTexture = properties.get(texture).__webglTexture;
        state.bindTexture(target, webglTexture), generateMipmap(target, texture, renderTarget.width, renderTarget.height), state.bindTexture(target, null);
      }
    }
  }
  function updateMultisampleRenderTarget(renderTarget) {
    if (renderTarget.isWebGLMultisampleRenderTarget)
      if (isWebGL2) {
        let width = renderTarget.width, height = renderTarget.height, mask = 16384;
        renderTarget.depthBuffer && (mask |= 256), renderTarget.stencilBuffer && (mask |= 1024);
        let renderTargetProperties = properties.get(renderTarget);
        state.bindFramebuffer(36008, renderTargetProperties.__webglMultisampledFramebuffer), state.bindFramebuffer(36009, renderTargetProperties.__webglFramebuffer), _gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, mask, 9728), state.bindFramebuffer(36008, null), state.bindFramebuffer(36009, renderTargetProperties.__webglMultisampledFramebuffer);
      } else
        console.warn("THREE.WebGLRenderer: WebGLMultisampleRenderTarget can only be used with WebGL2.");
  }
  function getRenderTargetSamples(renderTarget) {
    return isWebGL2 && renderTarget.isWebGLMultisampleRenderTarget ? Math.min(maxSamples, renderTarget.samples) : 0;
  }
  function updateVideoTexture(texture) {
    let frame = info.render.frame;
    _videoTextures.get(texture) !== frame && (_videoTextures.set(texture, frame), texture.update());
  }
  let warnedTexture2D = !1, warnedTextureCube = !1;
  function safeSetTexture2D(texture, slot) {
    texture && texture.isWebGLRenderTarget && (warnedTexture2D === !1 && (console.warn("THREE.WebGLTextures.safeSetTexture2D: don't use render targets as textures. Use their .texture property instead."), warnedTexture2D = !0), texture = texture.texture), setTexture2D(texture, slot);
  }
  function safeSetTextureCube(texture, slot) {
    texture && texture.isWebGLCubeRenderTarget && (warnedTextureCube === !1 && (console.warn("THREE.WebGLTextures.safeSetTextureCube: don't use cube render targets as textures. Use their .texture property instead."), warnedTextureCube = !0), texture = texture.texture), setTextureCube(texture, slot);
  }
  this.allocateTextureUnit = allocateTextureUnit, this.resetTextureUnits = resetTextureUnits, this.setTexture2D = setTexture2D, this.setTexture2DArray = setTexture2DArray, this.setTexture3D = setTexture3D, this.setTextureCube = setTextureCube, this.setupRenderTarget = setupRenderTarget, this.updateRenderTargetMipmap = updateRenderTargetMipmap, this.updateMultisampleRenderTarget = updateMultisampleRenderTarget, this.safeSetTexture2D = safeSetTexture2D, this.safeSetTextureCube = safeSetTextureCube;
}
function WebGLUtils(gl, extensions, capabilities) {
  let isWebGL2 = capabilities.isWebGL2;
  function convert(p) {
    let extension;
    if (p === UnsignedByteType)
      return 5121;
    if (p === UnsignedShort4444Type)
      return 32819;
    if (p === UnsignedShort5551Type)
      return 32820;
    if (p === UnsignedShort565Type)
      return 33635;
    if (p === ByteType)
      return 5120;
    if (p === ShortType)
      return 5122;
    if (p === UnsignedShortType)
      return 5123;
    if (p === IntType)
      return 5124;
    if (p === UnsignedIntType)
      return 5125;
    if (p === FloatType)
      return 5126;
    if (p === HalfFloatType)
      return isWebGL2 ? 5131 : (extension = extensions.get("OES_texture_half_float"), extension !== null ? extension.HALF_FLOAT_OES : null);
    if (p === AlphaFormat)
      return 6406;
    if (p === RGBFormat)
      return 6407;
    if (p === RGBAFormat)
      return 6408;
    if (p === LuminanceFormat)
      return 6409;
    if (p === LuminanceAlphaFormat)
      return 6410;
    if (p === DepthFormat)
      return 6402;
    if (p === DepthStencilFormat)
      return 34041;
    if (p === RedFormat)
      return 6403;
    if (p === RedIntegerFormat)
      return 36244;
    if (p === RGFormat)
      return 33319;
    if (p === RGIntegerFormat)
      return 33320;
    if (p === RGBIntegerFormat)
      return 36248;
    if (p === RGBAIntegerFormat)
      return 36249;
    if (p === RGB_S3TC_DXT1_Format || p === RGBA_S3TC_DXT1_Format || p === RGBA_S3TC_DXT3_Format || p === RGBA_S3TC_DXT5_Format)
      if (extension = extensions.get("WEBGL_compressed_texture_s3tc"), extension !== null) {
        if (p === RGB_S3TC_DXT1_Format)
          return extension.COMPRESSED_RGB_S3TC_DXT1_EXT;
        if (p === RGBA_S3TC_DXT1_Format)
          return extension.COMPRESSED_RGBA_S3TC_DXT1_EXT;
        if (p === RGBA_S3TC_DXT3_Format)
          return extension.COMPRESSED_RGBA_S3TC_DXT3_EXT;
        if (p === RGBA_S3TC_DXT5_Format)
          return extension.COMPRESSED_RGBA_S3TC_DXT5_EXT;
      } else
        return null;
    if (p === RGB_PVRTC_4BPPV1_Format || p === RGB_PVRTC_2BPPV1_Format || p === RGBA_PVRTC_4BPPV1_Format || p === RGBA_PVRTC_2BPPV1_Format)
      if (extension = extensions.get("WEBGL_compressed_texture_pvrtc"), extension !== null) {
        if (p === RGB_PVRTC_4BPPV1_Format)
          return extension.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;
        if (p === RGB_PVRTC_2BPPV1_Format)
          return extension.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;
        if (p === RGBA_PVRTC_4BPPV1_Format)
          return extension.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;
        if (p === RGBA_PVRTC_2BPPV1_Format)
          return extension.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG;
      } else
        return null;
    if (p === RGB_ETC1_Format)
      return extension = extensions.get("WEBGL_compressed_texture_etc1"), extension !== null ? extension.COMPRESSED_RGB_ETC1_WEBGL : null;
    if ((p === RGB_ETC2_Format || p === RGBA_ETC2_EAC_Format) && (extension = extensions.get("WEBGL_compressed_texture_etc"), extension !== null)) {
      if (p === RGB_ETC2_Format)
        return extension.COMPRESSED_RGB8_ETC2;
      if (p === RGBA_ETC2_EAC_Format)
        return extension.COMPRESSED_RGBA8_ETC2_EAC;
    }
    if (p === RGBA_ASTC_4x4_Format || p === RGBA_ASTC_5x4_Format || p === RGBA_ASTC_5x5_Format || p === RGBA_ASTC_6x5_Format || p === RGBA_ASTC_6x6_Format || p === RGBA_ASTC_8x5_Format || p === RGBA_ASTC_8x6_Format || p === RGBA_ASTC_8x8_Format || p === RGBA_ASTC_10x5_Format || p === RGBA_ASTC_10x6_Format || p === RGBA_ASTC_10x8_Format || p === RGBA_ASTC_10x10_Format || p === RGBA_ASTC_12x10_Format || p === RGBA_ASTC_12x12_Format || p === SRGB8_ALPHA8_ASTC_4x4_Format || p === SRGB8_ALPHA8_ASTC_5x4_Format || p === SRGB8_ALPHA8_ASTC_5x5_Format || p === SRGB8_ALPHA8_ASTC_6x5_Format || p === SRGB8_ALPHA8_ASTC_6x6_Format || p === SRGB8_ALPHA8_ASTC_8x5_Format || p === SRGB8_ALPHA8_ASTC_8x6_Format || p === SRGB8_ALPHA8_ASTC_8x8_Format || p === SRGB8_ALPHA8_ASTC_10x5_Format || p === SRGB8_ALPHA8_ASTC_10x6_Format || p === SRGB8_ALPHA8_ASTC_10x8_Format || p === SRGB8_ALPHA8_ASTC_10x10_Format || p === SRGB8_ALPHA8_ASTC_12x10_Format || p === SRGB8_ALPHA8_ASTC_12x12_Format)
      return extension = extensions.get("WEBGL_compressed_texture_astc"), extension !== null ? p : null;
    if (p === RGBA_BPTC_Format)
      return extension = extensions.get("EXT_texture_compression_bptc"), extension !== null ? p : null;
    if (p === UnsignedInt248Type)
      return isWebGL2 ? 34042 : (extension = extensions.get("WEBGL_depth_texture"), extension !== null ? extension.UNSIGNED_INT_24_8_WEBGL : null);
  }
  return { convert };
}
var ArrayCamera = class extends PerspectiveCamera {
  constructor(array = []) {
    super();
    this.cameras = array;
  }
};
ArrayCamera.prototype.isArrayCamera = !0;
var Group = class extends Object3D {
  constructor() {
    super();
    this.type = "Group";
  }
};
Group.prototype.isGroup = !0;
var _moveEvent = { type: "move" }, WebXRController = class {
  constructor() {
    this._targetRay = null, this._grip = null, this._hand = null;
  }
  getHandSpace() {
    return this._hand === null && (this._hand = new Group(), this._hand.matrixAutoUpdate = !1, this._hand.visible = !1, this._hand.joints = {}, this._hand.inputState = { pinching: !1 }), this._hand;
  }
  getTargetRaySpace() {
    return this._targetRay === null && (this._targetRay = new Group(), this._targetRay.matrixAutoUpdate = !1, this._targetRay.visible = !1, this._targetRay.hasLinearVelocity = !1, this._targetRay.linearVelocity = new Vector3(), this._targetRay.hasAngularVelocity = !1, this._targetRay.angularVelocity = new Vector3()), this._targetRay;
  }
  getGripSpace() {
    return this._grip === null && (this._grip = new Group(), this._grip.matrixAutoUpdate = !1, this._grip.visible = !1, this._grip.hasLinearVelocity = !1, this._grip.linearVelocity = new Vector3(), this._grip.hasAngularVelocity = !1, this._grip.angularVelocity = new Vector3()), this._grip;
  }
  dispatchEvent(event) {
    return this._targetRay !== null && this._targetRay.dispatchEvent(event), this._grip !== null && this._grip.dispatchEvent(event), this._hand !== null && this._hand.dispatchEvent(event), this;
  }
  disconnect(inputSource) {
    return this.dispatchEvent({ type: "disconnected", data: inputSource }), this._targetRay !== null && (this._targetRay.visible = !1), this._grip !== null && (this._grip.visible = !1), this._hand !== null && (this._hand.visible = !1), this;
  }
  update(inputSource, frame, referenceSpace) {
    let inputPose = null, gripPose = null, handPose = null, targetRay = this._targetRay, grip = this._grip, hand = this._hand;
    if (inputSource && frame.session.visibilityState !== "visible-blurred")
      if (targetRay !== null && (inputPose = frame.getPose(inputSource.targetRaySpace, referenceSpace), inputPose !== null && (targetRay.matrix.fromArray(inputPose.transform.matrix), targetRay.matrix.decompose(targetRay.position, targetRay.rotation, targetRay.scale), inputPose.linearVelocity ? (targetRay.hasLinearVelocity = !0, targetRay.linearVelocity.copy(inputPose.linearVelocity)) : targetRay.hasLinearVelocity = !1, inputPose.angularVelocity ? (targetRay.hasAngularVelocity = !0, targetRay.angularVelocity.copy(inputPose.angularVelocity)) : targetRay.hasAngularVelocity = !1, this.dispatchEvent(_moveEvent))), hand && inputSource.hand) {
        handPose = !0;
        for (let inputjoint of inputSource.hand.values()) {
          let jointPose = frame.getJointPose(inputjoint, referenceSpace);
          if (hand.joints[inputjoint.jointName] === void 0) {
            let joint2 = new Group();
            joint2.matrixAutoUpdate = !1, joint2.visible = !1, hand.joints[inputjoint.jointName] = joint2, hand.add(joint2);
          }
          let joint = hand.joints[inputjoint.jointName];
          jointPose !== null && (joint.matrix.fromArray(jointPose.transform.matrix), joint.matrix.decompose(joint.position, joint.rotation, joint.scale), joint.jointRadius = jointPose.radius), joint.visible = jointPose !== null;
        }
        let indexTip = hand.joints["index-finger-tip"], thumbTip = hand.joints["thumb-tip"], distance = indexTip.position.distanceTo(thumbTip.position), distanceToPinch = 0.02, threshold = 5e-3;
        hand.inputState.pinching && distance > distanceToPinch + threshold ? (hand.inputState.pinching = !1, this.dispatchEvent({
          type: "pinchend",
          handedness: inputSource.handedness,
          target: this
        })) : !hand.inputState.pinching && distance <= distanceToPinch - threshold && (hand.inputState.pinching = !0, this.dispatchEvent({
          type: "pinchstart",
          handedness: inputSource.handedness,
          target: this
        }));
      } else
        grip !== null && inputSource.gripSpace && (gripPose = frame.getPose(inputSource.gripSpace, referenceSpace), gripPose !== null && (grip.matrix.fromArray(gripPose.transform.matrix), grip.matrix.decompose(grip.position, grip.rotation, grip.scale), gripPose.linearVelocity ? (grip.hasLinearVelocity = !0, grip.linearVelocity.copy(gripPose.linearVelocity)) : grip.hasLinearVelocity = !1, gripPose.angularVelocity ? (grip.hasAngularVelocity = !0, grip.angularVelocity.copy(gripPose.angularVelocity)) : grip.hasAngularVelocity = !1));
    return targetRay !== null && (targetRay.visible = inputPose !== null), grip !== null && (grip.visible = gripPose !== null), hand !== null && (hand.visible = handPose !== null), this;
  }
}, WebXRManager = class extends EventDispatcher {
  constructor(renderer, gl) {
    super();
    let scope = this, state = renderer.state, session = null, framebufferScaleFactor = 1, referenceSpace = null, referenceSpaceType = "local-floor", pose = null, controllers = [], inputSourcesMap = new Map(), cameraL = new PerspectiveCamera();
    cameraL.layers.enable(1), cameraL.viewport = new Vector4();
    let cameraR = new PerspectiveCamera();
    cameraR.layers.enable(2), cameraR.viewport = new Vector4();
    let cameras = [cameraL, cameraR], cameraVR = new ArrayCamera();
    cameraVR.layers.enable(1), cameraVR.layers.enable(2);
    let _currentDepthNear = null, _currentDepthFar = null;
    this.cameraAutoUpdate = !0, this.enabled = !1, this.isPresenting = !1, this.getController = function(index) {
      let controller = controllers[index];
      return controller === void 0 && (controller = new WebXRController(), controllers[index] = controller), controller.getTargetRaySpace();
    }, this.getControllerGrip = function(index) {
      let controller = controllers[index];
      return controller === void 0 && (controller = new WebXRController(), controllers[index] = controller), controller.getGripSpace();
    }, this.getHand = function(index) {
      let controller = controllers[index];
      return controller === void 0 && (controller = new WebXRController(), controllers[index] = controller), controller.getHandSpace();
    };
    function onSessionEvent(event) {
      let controller = inputSourcesMap.get(event.inputSource);
      controller && controller.dispatchEvent({ type: event.type, data: event.inputSource });
    }
    function onSessionEnd() {
      inputSourcesMap.forEach(function(controller, inputSource) {
        controller.disconnect(inputSource);
      }), inputSourcesMap.clear(), _currentDepthNear = null, _currentDepthFar = null, state.bindXRFramebuffer(null), renderer.setRenderTarget(renderer.getRenderTarget()), animation.stop(), scope.isPresenting = !1, scope.dispatchEvent({ type: "sessionend" });
    }
    this.setFramebufferScaleFactor = function(value) {
      framebufferScaleFactor = value, scope.isPresenting === !0 && console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.");
    }, this.setReferenceSpaceType = function(value) {
      referenceSpaceType = value, scope.isPresenting === !0 && console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.");
    }, this.getReferenceSpace = function() {
      return referenceSpace;
    }, this.getSession = function() {
      return session;
    }, this.setSession = async function(value) {
      if (session = value, session !== null) {
        session.addEventListener("select", onSessionEvent), session.addEventListener("selectstart", onSessionEvent), session.addEventListener("selectend", onSessionEvent), session.addEventListener("squeeze", onSessionEvent), session.addEventListener("squeezestart", onSessionEvent), session.addEventListener("squeezeend", onSessionEvent), session.addEventListener("end", onSessionEnd), session.addEventListener("inputsourceschange", onInputSourcesChange);
        let attributes = gl.getContextAttributes();
        attributes.xrCompatible !== !0 && await gl.makeXRCompatible();
        let layerInit = {
          antialias: attributes.antialias,
          alpha: attributes.alpha,
          depth: attributes.depth,
          stencil: attributes.stencil,
          framebufferScaleFactor
        }, baseLayer = new XRWebGLLayer(session, gl, layerInit);
        session.updateRenderState({ baseLayer }), referenceSpace = await session.requestReferenceSpace(referenceSpaceType), animation.setContext(session), animation.start(), scope.isPresenting = !0, scope.dispatchEvent({ type: "sessionstart" });
      }
    };
    function onInputSourcesChange(event) {
      let inputSources = session.inputSources;
      for (let i = 0; i < controllers.length; i++)
        inputSourcesMap.set(inputSources[i], controllers[i]);
      for (let i = 0; i < event.removed.length; i++) {
        let inputSource = event.removed[i], controller = inputSourcesMap.get(inputSource);
        controller && (controller.dispatchEvent({ type: "disconnected", data: inputSource }), inputSourcesMap.delete(inputSource));
      }
      for (let i = 0; i < event.added.length; i++) {
        let inputSource = event.added[i], controller = inputSourcesMap.get(inputSource);
        controller && controller.dispatchEvent({ type: "connected", data: inputSource });
      }
    }
    let cameraLPos = new Vector3(), cameraRPos = new Vector3();
    function setProjectionFromUnion(camera, cameraL2, cameraR2) {
      cameraLPos.setFromMatrixPosition(cameraL2.matrixWorld), cameraRPos.setFromMatrixPosition(cameraR2.matrixWorld);
      let ipd = cameraLPos.distanceTo(cameraRPos), projL = cameraL2.projectionMatrix.elements, projR = cameraR2.projectionMatrix.elements, near = projL[14] / (projL[10] - 1), far = projL[14] / (projL[10] + 1), topFov = (projL[9] + 1) / projL[5], bottomFov = (projL[9] - 1) / projL[5], leftFov = (projL[8] - 1) / projL[0], rightFov = (projR[8] + 1) / projR[0], left = near * leftFov, right = near * rightFov, zOffset = ipd / (-leftFov + rightFov), xOffset = zOffset * -leftFov;
      cameraL2.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale), camera.translateX(xOffset), camera.translateZ(zOffset), camera.matrixWorld.compose(camera.position, camera.quaternion, camera.scale), camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      let near2 = near + zOffset, far2 = far + zOffset, left2 = left - xOffset, right2 = right + (ipd - xOffset), top2 = topFov * far / far2 * near2, bottom2 = bottomFov * far / far2 * near2;
      camera.projectionMatrix.makePerspective(left2, right2, top2, bottom2, near2, far2);
    }
    function updateCamera(camera, parent) {
      parent === null ? camera.matrixWorld.copy(camera.matrix) : camera.matrixWorld.multiplyMatrices(parent.matrixWorld, camera.matrix), camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    }
    this.updateCamera = function(camera) {
      if (session === null)
        return;
      cameraVR.near = cameraR.near = cameraL.near = camera.near, cameraVR.far = cameraR.far = cameraL.far = camera.far, (_currentDepthNear !== cameraVR.near || _currentDepthFar !== cameraVR.far) && (session.updateRenderState({
        depthNear: cameraVR.near,
        depthFar: cameraVR.far
      }), _currentDepthNear = cameraVR.near, _currentDepthFar = cameraVR.far);
      let parent = camera.parent, cameras2 = cameraVR.cameras;
      updateCamera(cameraVR, parent);
      for (let i = 0; i < cameras2.length; i++)
        updateCamera(cameras2[i], parent);
      camera.matrixWorld.copy(cameraVR.matrixWorld), camera.matrix.copy(cameraVR.matrix), camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
      let children = camera.children;
      for (let i = 0, l = children.length; i < l; i++)
        children[i].updateMatrixWorld(!0);
      cameras2.length === 2 ? setProjectionFromUnion(cameraVR, cameraL, cameraR) : cameraVR.projectionMatrix.copy(cameraL.projectionMatrix);
    }, this.getCamera = function() {
      return cameraVR;
    };
    let onAnimationFrameCallback = null;
    function onAnimationFrame(time, frame) {
      if (pose = frame.getViewerPose(referenceSpace), pose !== null) {
        let views = pose.views, baseLayer = session.renderState.baseLayer;
        state.bindXRFramebuffer(baseLayer.framebuffer);
        let cameraVRNeedsUpdate = !1;
        views.length !== cameraVR.cameras.length && (cameraVR.cameras.length = 0, cameraVRNeedsUpdate = !0);
        for (let i = 0; i < views.length; i++) {
          let view = views[i], viewport = baseLayer.getViewport(view), camera = cameras[i];
          camera.matrix.fromArray(view.transform.matrix), camera.projectionMatrix.fromArray(view.projectionMatrix), camera.viewport.set(viewport.x, viewport.y, viewport.width, viewport.height), i === 0 && cameraVR.matrix.copy(camera.matrix), cameraVRNeedsUpdate === !0 && cameraVR.cameras.push(camera);
        }
      }
      let inputSources = session.inputSources;
      for (let i = 0; i < controllers.length; i++) {
        let controller = controllers[i], inputSource = inputSources[i];
        controller.update(inputSource, frame, referenceSpace);
      }
      onAnimationFrameCallback && onAnimationFrameCallback(time, frame);
    }
    let animation = new WebGLAnimation();
    animation.setAnimationLoop(onAnimationFrame), this.setAnimationLoop = function(callback) {
      onAnimationFrameCallback = callback;
    }, this.dispose = function() {
    };
  }
};
function WebGLMaterials(properties) {
  function refreshFogUniforms(uniforms, fog) {
    uniforms.fogColor.value.copy(fog.color), fog.isFog ? (uniforms.fogNear.value = fog.near, uniforms.fogFar.value = fog.far) : fog.isFogExp2 && (uniforms.fogDensity.value = fog.density);
  }
  function refreshMaterialUniforms(uniforms, material, pixelRatio, height, transmissionRenderTarget) {
    material.isMeshBasicMaterial ? refreshUniformsCommon(uniforms, material) : material.isMeshLambertMaterial ? (refreshUniformsCommon(uniforms, material), refreshUniformsLambert(uniforms, material)) : material.isMeshToonMaterial ? (refreshUniformsCommon(uniforms, material), refreshUniformsToon(uniforms, material)) : material.isMeshPhongMaterial ? (refreshUniformsCommon(uniforms, material), refreshUniformsPhong(uniforms, material)) : material.isMeshStandardMaterial ? (refreshUniformsCommon(uniforms, material), material.isMeshPhysicalMaterial ? refreshUniformsPhysical(uniforms, material, transmissionRenderTarget) : refreshUniformsStandard(uniforms, material)) : material.isMeshMatcapMaterial ? (refreshUniformsCommon(uniforms, material), refreshUniformsMatcap(uniforms, material)) : material.isMeshDepthMaterial ? (refreshUniformsCommon(uniforms, material), refreshUniformsDepth(uniforms, material)) : material.isMeshDistanceMaterial ? (refreshUniformsCommon(uniforms, material), refreshUniformsDistance(uniforms, material)) : material.isMeshNormalMaterial ? (refreshUniformsCommon(uniforms, material), refreshUniformsNormal(uniforms, material)) : material.isLineBasicMaterial ? (refreshUniformsLine(uniforms, material), material.isLineDashedMaterial && refreshUniformsDash(uniforms, material)) : material.isPointsMaterial ? refreshUniformsPoints(uniforms, material, pixelRatio, height) : material.isSpriteMaterial ? refreshUniformsSprites(uniforms, material) : material.isShadowMaterial ? (uniforms.color.value.copy(material.color), uniforms.opacity.value = material.opacity) : material.isShaderMaterial && (material.uniformsNeedUpdate = !1);
  }
  function refreshUniformsCommon(uniforms, material) {
    uniforms.opacity.value = material.opacity, material.color && uniforms.diffuse.value.copy(material.color), material.emissive && uniforms.emissive.value.copy(material.emissive).multiplyScalar(material.emissiveIntensity), material.map && (uniforms.map.value = material.map), material.alphaMap && (uniforms.alphaMap.value = material.alphaMap), material.specularMap && (uniforms.specularMap.value = material.specularMap);
    let envMap = properties.get(material).envMap;
    if (envMap) {
      uniforms.envMap.value = envMap, uniforms.flipEnvMap.value = envMap.isCubeTexture && envMap._needsFlipEnvMap ? -1 : 1, uniforms.reflectivity.value = material.reflectivity, uniforms.refractionRatio.value = material.refractionRatio;
      let maxMipLevel = properties.get(envMap).__maxMipLevel;
      maxMipLevel !== void 0 && (uniforms.maxMipLevel.value = maxMipLevel);
    }
    material.lightMap && (uniforms.lightMap.value = material.lightMap, uniforms.lightMapIntensity.value = material.lightMapIntensity), material.aoMap && (uniforms.aoMap.value = material.aoMap, uniforms.aoMapIntensity.value = material.aoMapIntensity);
    let uvScaleMap;
    material.map ? uvScaleMap = material.map : material.specularMap ? uvScaleMap = material.specularMap : material.displacementMap ? uvScaleMap = material.displacementMap : material.normalMap ? uvScaleMap = material.normalMap : material.bumpMap ? uvScaleMap = material.bumpMap : material.roughnessMap ? uvScaleMap = material.roughnessMap : material.metalnessMap ? uvScaleMap = material.metalnessMap : material.alphaMap ? uvScaleMap = material.alphaMap : material.emissiveMap ? uvScaleMap = material.emissiveMap : material.clearcoatMap ? uvScaleMap = material.clearcoatMap : material.clearcoatNormalMap ? uvScaleMap = material.clearcoatNormalMap : material.clearcoatRoughnessMap && (uvScaleMap = material.clearcoatRoughnessMap), uvScaleMap !== void 0 && (uvScaleMap.isWebGLRenderTarget && (uvScaleMap = uvScaleMap.texture), uvScaleMap.matrixAutoUpdate === !0 && uvScaleMap.updateMatrix(), uniforms.uvTransform.value.copy(uvScaleMap.matrix));
    let uv2ScaleMap;
    material.aoMap ? uv2ScaleMap = material.aoMap : material.lightMap && (uv2ScaleMap = material.lightMap), uv2ScaleMap !== void 0 && (uv2ScaleMap.isWebGLRenderTarget && (uv2ScaleMap = uv2ScaleMap.texture), uv2ScaleMap.matrixAutoUpdate === !0 && uv2ScaleMap.updateMatrix(), uniforms.uv2Transform.value.copy(uv2ScaleMap.matrix));
  }
  function refreshUniformsLine(uniforms, material) {
    uniforms.diffuse.value.copy(material.color), uniforms.opacity.value = material.opacity;
  }
  function refreshUniformsDash(uniforms, material) {
    uniforms.dashSize.value = material.dashSize, uniforms.totalSize.value = material.dashSize + material.gapSize, uniforms.scale.value = material.scale;
  }
  function refreshUniformsPoints(uniforms, material, pixelRatio, height) {
    uniforms.diffuse.value.copy(material.color), uniforms.opacity.value = material.opacity, uniforms.size.value = material.size * pixelRatio, uniforms.scale.value = height * 0.5, material.map && (uniforms.map.value = material.map), material.alphaMap && (uniforms.alphaMap.value = material.alphaMap);
    let uvScaleMap;
    material.map ? uvScaleMap = material.map : material.alphaMap && (uvScaleMap = material.alphaMap), uvScaleMap !== void 0 && (uvScaleMap.matrixAutoUpdate === !0 && uvScaleMap.updateMatrix(), uniforms.uvTransform.value.copy(uvScaleMap.matrix));
  }
  function refreshUniformsSprites(uniforms, material) {
    uniforms.diffuse.value.copy(material.color), uniforms.opacity.value = material.opacity, uniforms.rotation.value = material.rotation, material.map && (uniforms.map.value = material.map), material.alphaMap && (uniforms.alphaMap.value = material.alphaMap);
    let uvScaleMap;
    material.map ? uvScaleMap = material.map : material.alphaMap && (uvScaleMap = material.alphaMap), uvScaleMap !== void 0 && (uvScaleMap.matrixAutoUpdate === !0 && uvScaleMap.updateMatrix(), uniforms.uvTransform.value.copy(uvScaleMap.matrix));
  }
  function refreshUniformsLambert(uniforms, material) {
    material.emissiveMap && (uniforms.emissiveMap.value = material.emissiveMap);
  }
  function refreshUniformsPhong(uniforms, material) {
    uniforms.specular.value.copy(material.specular), uniforms.shininess.value = Math.max(material.shininess, 1e-4), material.emissiveMap && (uniforms.emissiveMap.value = material.emissiveMap), material.bumpMap && (uniforms.bumpMap.value = material.bumpMap, uniforms.bumpScale.value = material.bumpScale, material.side === BackSide && (uniforms.bumpScale.value *= -1)), material.normalMap && (uniforms.normalMap.value = material.normalMap, uniforms.normalScale.value.copy(material.normalScale), material.side === BackSide && uniforms.normalScale.value.negate()), material.displacementMap && (uniforms.displacementMap.value = material.displacementMap, uniforms.displacementScale.value = material.displacementScale, uniforms.displacementBias.value = material.displacementBias);
  }
  function refreshUniformsToon(uniforms, material) {
    material.gradientMap && (uniforms.gradientMap.value = material.gradientMap), material.emissiveMap && (uniforms.emissiveMap.value = material.emissiveMap), material.bumpMap && (uniforms.bumpMap.value = material.bumpMap, uniforms.bumpScale.value = material.bumpScale, material.side === BackSide && (uniforms.bumpScale.value *= -1)), material.normalMap && (uniforms.normalMap.value = material.normalMap, uniforms.normalScale.value.copy(material.normalScale), material.side === BackSide && uniforms.normalScale.value.negate()), material.displacementMap && (uniforms.displacementMap.value = material.displacementMap, uniforms.displacementScale.value = material.displacementScale, uniforms.displacementBias.value = material.displacementBias);
  }
  function refreshUniformsStandard(uniforms, material) {
    uniforms.roughness.value = material.roughness, uniforms.metalness.value = material.metalness, material.roughnessMap && (uniforms.roughnessMap.value = material.roughnessMap), material.metalnessMap && (uniforms.metalnessMap.value = material.metalnessMap), material.emissiveMap && (uniforms.emissiveMap.value = material.emissiveMap), material.bumpMap && (uniforms.bumpMap.value = material.bumpMap, uniforms.bumpScale.value = material.bumpScale, material.side === BackSide && (uniforms.bumpScale.value *= -1)), material.normalMap && (uniforms.normalMap.value = material.normalMap, uniforms.normalScale.value.copy(material.normalScale), material.side === BackSide && uniforms.normalScale.value.negate()), material.displacementMap && (uniforms.displacementMap.value = material.displacementMap, uniforms.displacementScale.value = material.displacementScale, uniforms.displacementBias.value = material.displacementBias), properties.get(material).envMap && (uniforms.envMapIntensity.value = material.envMapIntensity);
  }
  function refreshUniformsPhysical(uniforms, material, transmissionRenderTarget) {
    refreshUniformsStandard(uniforms, material), uniforms.reflectivity.value = material.reflectivity, uniforms.clearcoat.value = material.clearcoat, uniforms.clearcoatRoughness.value = material.clearcoatRoughness, material.sheen && uniforms.sheen.value.copy(material.sheen), material.clearcoatMap && (uniforms.clearcoatMap.value = material.clearcoatMap), material.clearcoatRoughnessMap && (uniforms.clearcoatRoughnessMap.value = material.clearcoatRoughnessMap), material.clearcoatNormalMap && (uniforms.clearcoatNormalScale.value.copy(material.clearcoatNormalScale), uniforms.clearcoatNormalMap.value = material.clearcoatNormalMap, material.side === BackSide && uniforms.clearcoatNormalScale.value.negate()), uniforms.transmission.value = material.transmission, material.transmissionMap && (uniforms.transmissionMap.value = material.transmissionMap), material.transmission > 0 && (uniforms.transmissionSamplerMap.value = transmissionRenderTarget.texture, uniforms.transmissionSamplerSize.value.set(transmissionRenderTarget.width, transmissionRenderTarget.height)), uniforms.thickness.value = material.thickness, material.thicknessMap && (uniforms.thicknessMap.value = material.thicknessMap), uniforms.attenuationDistance.value = material.attenuationDistance, uniforms.attenuationColor.value.copy(material.attenuationColor);
  }
  function refreshUniformsMatcap(uniforms, material) {
    material.matcap && (uniforms.matcap.value = material.matcap), material.bumpMap && (uniforms.bumpMap.value = material.bumpMap, uniforms.bumpScale.value = material.bumpScale, material.side === BackSide && (uniforms.bumpScale.value *= -1)), material.normalMap && (uniforms.normalMap.value = material.normalMap, uniforms.normalScale.value.copy(material.normalScale), material.side === BackSide && uniforms.normalScale.value.negate()), material.displacementMap && (uniforms.displacementMap.value = material.displacementMap, uniforms.displacementScale.value = material.displacementScale, uniforms.displacementBias.value = material.displacementBias);
  }
  function refreshUniformsDepth(uniforms, material) {
    material.displacementMap && (uniforms.displacementMap.value = material.displacementMap, uniforms.displacementScale.value = material.displacementScale, uniforms.displacementBias.value = material.displacementBias);
  }
  function refreshUniformsDistance(uniforms, material) {
    material.displacementMap && (uniforms.displacementMap.value = material.displacementMap, uniforms.displacementScale.value = material.displacementScale, uniforms.displacementBias.value = material.displacementBias), uniforms.referencePosition.value.copy(material.referencePosition), uniforms.nearDistance.value = material.nearDistance, uniforms.farDistance.value = material.farDistance;
  }
  function refreshUniformsNormal(uniforms, material) {
    material.bumpMap && (uniforms.bumpMap.value = material.bumpMap, uniforms.bumpScale.value = material.bumpScale, material.side === BackSide && (uniforms.bumpScale.value *= -1)), material.normalMap && (uniforms.normalMap.value = material.normalMap, uniforms.normalScale.value.copy(material.normalScale), material.side === BackSide && uniforms.normalScale.value.negate()), material.displacementMap && (uniforms.displacementMap.value = material.displacementMap, uniforms.displacementScale.value = material.displacementScale, uniforms.displacementBias.value = material.displacementBias);
  }
  return {
    refreshFogUniforms,
    refreshMaterialUniforms
  };
}
function createCanvasElement() {
  let canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  return canvas.style.display = "block", canvas;
}
function WebGLRenderer(parameters) {
  parameters = parameters || {};
  let _canvas2 = parameters.canvas !== void 0 ? parameters.canvas : createCanvasElement(), _context2 = parameters.context !== void 0 ? parameters.context : null, _alpha = parameters.alpha !== void 0 ? parameters.alpha : !1, _depth = parameters.depth !== void 0 ? parameters.depth : !0, _stencil = parameters.stencil !== void 0 ? parameters.stencil : !0, _antialias = parameters.antialias !== void 0 ? parameters.antialias : !1, _premultipliedAlpha = parameters.premultipliedAlpha !== void 0 ? parameters.premultipliedAlpha : !0, _preserveDrawingBuffer = parameters.preserveDrawingBuffer !== void 0 ? parameters.preserveDrawingBuffer : !1, _powerPreference = parameters.powerPreference !== void 0 ? parameters.powerPreference : "default", _failIfMajorPerformanceCaveat = parameters.failIfMajorPerformanceCaveat !== void 0 ? parameters.failIfMajorPerformanceCaveat : !1, currentRenderList = null, currentRenderState = null, renderListStack = [], renderStateStack = [];
  this.domElement = _canvas2, this.debug = {
    checkShaderErrors: !0
  }, this.autoClear = !0, this.autoClearColor = !0, this.autoClearDepth = !0, this.autoClearStencil = !0, this.sortObjects = !0, this.clippingPlanes = [], this.localClippingEnabled = !1, this.gammaFactor = 2, this.outputEncoding = LinearEncoding, this.physicallyCorrectLights = !1, this.toneMapping = NoToneMapping, this.toneMappingExposure = 1;
  let _this = this, _isContextLost = !1, _currentActiveCubeFace = 0, _currentActiveMipmapLevel = 0, _currentRenderTarget = null, _currentMaterialId = -1, _currentCamera = null, _currentViewport = new Vector4(), _currentScissor = new Vector4(), _currentScissorTest = null, _width = _canvas2.width, _height = _canvas2.height, _pixelRatio = 1, _opaqueSort = null, _transparentSort = null, _viewport = new Vector4(0, 0, _width, _height), _scissor = new Vector4(0, 0, _width, _height), _scissorTest = !1, _currentDrawBuffers = [], _frustum = new Frustum(), _clippingEnabled = !1, _localClippingEnabled = !1, _transmissionRenderTarget = null, _projScreenMatrix2 = new Matrix4(), _vector3 = new Vector3(), _emptyScene = { background: null, fog: null, environment: null, overrideMaterial: null, isScene: !0 };
  function getTargetPixelRatio() {
    return _currentRenderTarget === null ? _pixelRatio : 1;
  }
  let _gl = _context2;
  function getContext(contextNames, contextAttributes) {
    for (let i = 0; i < contextNames.length; i++) {
      let contextName = contextNames[i], context = _canvas2.getContext(contextName, contextAttributes);
      if (context !== null)
        return context;
    }
    return null;
  }
  try {
    let contextAttributes = {
      alpha: _alpha,
      depth: _depth,
      stencil: _stencil,
      antialias: _antialias,
      premultipliedAlpha: _premultipliedAlpha,
      preserveDrawingBuffer: _preserveDrawingBuffer,
      powerPreference: _powerPreference,
      failIfMajorPerformanceCaveat: _failIfMajorPerformanceCaveat
    };
    if (_canvas2.addEventListener("webglcontextlost", onContextLost, !1), _canvas2.addEventListener("webglcontextrestored", onContextRestore, !1), _gl === null) {
      let contextNames = ["webgl2", "webgl", "experimental-webgl"];
      if (_this.isWebGL1Renderer === !0 && contextNames.shift(), _gl = getContext(contextNames, contextAttributes), _gl === null)
        throw getContext(contextNames) ? new Error("Error creating WebGL context with your selected attributes.") : new Error("Error creating WebGL context.");
    }
    _gl.getShaderPrecisionFormat === void 0 && (_gl.getShaderPrecisionFormat = function() {
      return { rangeMin: 1, rangeMax: 1, precision: 1 };
    });
  } catch (error) {
    throw console.error("THREE.WebGLRenderer: " + error.message), error;
  }
  let extensions, capabilities, state, info, properties, textures, cubemaps, attributes, geometries, objects, programCache, materials, renderLists, renderStates, clipping, shadowMap, background, morphtargets, bufferRenderer, indexedBufferRenderer, utils, bindingStates;
  function initGLContext() {
    extensions = new WebGLExtensions(_gl), capabilities = new WebGLCapabilities(_gl, extensions, parameters), extensions.init(capabilities), utils = new WebGLUtils(_gl, extensions, capabilities), state = new WebGLState(_gl, extensions, capabilities), _currentDrawBuffers[0] = 1029, info = new WebGLInfo(_gl), properties = new WebGLProperties(), textures = new WebGLTextures(_gl, extensions, state, properties, capabilities, utils, info), cubemaps = new WebGLCubeMaps(_this), attributes = new WebGLAttributes(_gl, capabilities), bindingStates = new WebGLBindingStates(_gl, extensions, attributes, capabilities), geometries = new WebGLGeometries(_gl, attributes, info, bindingStates), objects = new WebGLObjects(_gl, geometries, attributes, info), morphtargets = new WebGLMorphtargets(_gl), clipping = new WebGLClipping(properties), programCache = new WebGLPrograms(_this, cubemaps, extensions, capabilities, bindingStates, clipping), materials = new WebGLMaterials(properties), renderLists = new WebGLRenderLists(properties), renderStates = new WebGLRenderStates(extensions, capabilities), background = new WebGLBackground(_this, cubemaps, state, objects, _premultipliedAlpha), shadowMap = new WebGLShadowMap(_this, objects, capabilities), bufferRenderer = new WebGLBufferRenderer(_gl, extensions, info, capabilities), indexedBufferRenderer = new WebGLIndexedBufferRenderer(_gl, extensions, info, capabilities), info.programs = programCache.programs, _this.capabilities = capabilities, _this.extensions = extensions, _this.properties = properties, _this.renderLists = renderLists, _this.shadowMap = shadowMap, _this.state = state, _this.info = info;
  }
  initGLContext();
  let xr = new WebXRManager(_this, _gl);
  this.xr = xr, this.getContext = function() {
    return _gl;
  }, this.getContextAttributes = function() {
    return _gl.getContextAttributes();
  }, this.forceContextLoss = function() {
    let extension = extensions.get("WEBGL_lose_context");
    extension && extension.loseContext();
  }, this.forceContextRestore = function() {
    let extension = extensions.get("WEBGL_lose_context");
    extension && extension.restoreContext();
  }, this.getPixelRatio = function() {
    return _pixelRatio;
  }, this.setPixelRatio = function(value) {
    value !== void 0 && (_pixelRatio = value, this.setSize(_width, _height, !1));
  }, this.getSize = function(target) {
    return target === void 0 && (console.warn("WebGLRenderer: .getsize() now requires a Vector2 as an argument"), target = new Vector2()), target.set(_width, _height);
  }, this.setSize = function(width, height, updateStyle) {
    if (xr.isPresenting) {
      console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");
      return;
    }
    _width = width, _height = height, _canvas2.width = Math.floor(width * _pixelRatio), _canvas2.height = Math.floor(height * _pixelRatio), updateStyle !== !1 && (_canvas2.style.width = width + "px", _canvas2.style.height = height + "px"), this.setViewport(0, 0, width, height);
  }, this.getDrawingBufferSize = function(target) {
    return target === void 0 && (console.warn("WebGLRenderer: .getdrawingBufferSize() now requires a Vector2 as an argument"), target = new Vector2()), target.set(_width * _pixelRatio, _height * _pixelRatio).floor();
  }, this.setDrawingBufferSize = function(width, height, pixelRatio) {
    _width = width, _height = height, _pixelRatio = pixelRatio, _canvas2.width = Math.floor(width * pixelRatio), _canvas2.height = Math.floor(height * pixelRatio), this.setViewport(0, 0, width, height);
  }, this.getCurrentViewport = function(target) {
    return target === void 0 && (console.warn("WebGLRenderer: .getCurrentViewport() now requires a Vector4 as an argument"), target = new Vector4()), target.copy(_currentViewport);
  }, this.getViewport = function(target) {
    return target.copy(_viewport);
  }, this.setViewport = function(x, y, width, height) {
    x.isVector4 ? _viewport.set(x.x, x.y, x.z, x.w) : _viewport.set(x, y, width, height), state.viewport(_currentViewport.copy(_viewport).multiplyScalar(_pixelRatio).floor());
  }, this.getScissor = function(target) {
    return target.copy(_scissor);
  }, this.setScissor = function(x, y, width, height) {
    x.isVector4 ? _scissor.set(x.x, x.y, x.z, x.w) : _scissor.set(x, y, width, height), state.scissor(_currentScissor.copy(_scissor).multiplyScalar(_pixelRatio).floor());
  }, this.getScissorTest = function() {
    return _scissorTest;
  }, this.setScissorTest = function(boolean) {
    state.setScissorTest(_scissorTest = boolean);
  }, this.setOpaqueSort = function(method) {
    _opaqueSort = method;
  }, this.setTransparentSort = function(method) {
    _transparentSort = method;
  }, this.getClearColor = function(target) {
    return target === void 0 && (console.warn("WebGLRenderer: .getClearColor() now requires a Color as an argument"), target = new Color()), target.copy(background.getClearColor());
  }, this.setClearColor = function() {
    background.setClearColor.apply(background, arguments);
  }, this.getClearAlpha = function() {
    return background.getClearAlpha();
  }, this.setClearAlpha = function() {
    background.setClearAlpha.apply(background, arguments);
  }, this.clear = function(color, depth, stencil) {
    let bits = 0;
    (color === void 0 || color) && (bits |= 16384), (depth === void 0 || depth) && (bits |= 256), (stencil === void 0 || stencil) && (bits |= 1024), _gl.clear(bits);
  }, this.clearColor = function() {
    this.clear(!0, !1, !1);
  }, this.clearDepth = function() {
    this.clear(!1, !0, !1);
  }, this.clearStencil = function() {
    this.clear(!1, !1, !0);
  }, this.dispose = function() {
    _canvas2.removeEventListener("webglcontextlost", onContextLost, !1), _canvas2.removeEventListener("webglcontextrestored", onContextRestore, !1), renderLists.dispose(), renderStates.dispose(), properties.dispose(), cubemaps.dispose(), objects.dispose(), bindingStates.dispose(), xr.dispose(), xr.removeEventListener("sessionstart", onXRSessionStart), xr.removeEventListener("sessionend", onXRSessionEnd), _transmissionRenderTarget && (_transmissionRenderTarget.dispose(), _transmissionRenderTarget = null), animation.stop();
  };
  function onContextLost(event) {
    event.preventDefault(), console.log("THREE.WebGLRenderer: Context Lost."), _isContextLost = !0;
  }
  function onContextRestore() {
    console.log("THREE.WebGLRenderer: Context Restored."), _isContextLost = !1;
    let infoAutoReset = info.autoReset, shadowMapEnabled = shadowMap.enabled, shadowMapAutoUpdate = shadowMap.autoUpdate, shadowMapNeedsUpdate = shadowMap.needsUpdate, shadowMapType = shadowMap.type;
    initGLContext(), info.autoReset = infoAutoReset, shadowMap.enabled = shadowMapEnabled, shadowMap.autoUpdate = shadowMapAutoUpdate, shadowMap.needsUpdate = shadowMapNeedsUpdate, shadowMap.type = shadowMapType;
  }
  function onMaterialDispose(event) {
    let material = event.target;
    material.removeEventListener("dispose", onMaterialDispose), deallocateMaterial(material);
  }
  function deallocateMaterial(material) {
    releaseMaterialProgramReferences(material), properties.remove(material);
  }
  function releaseMaterialProgramReferences(material) {
    let programs = properties.get(material).programs;
    programs !== void 0 && programs.forEach(function(program) {
      programCache.releaseProgram(program);
    });
  }
  function renderObjectImmediate(object, program) {
    object.render(function(object2) {
      _this.renderBufferImmediate(object2, program);
    });
  }
  this.renderBufferImmediate = function(object, program) {
    bindingStates.initAttributes();
    let buffers = properties.get(object);
    object.hasPositions && !buffers.position && (buffers.position = _gl.createBuffer()), object.hasNormals && !buffers.normal && (buffers.normal = _gl.createBuffer()), object.hasUvs && !buffers.uv && (buffers.uv = _gl.createBuffer()), object.hasColors && !buffers.color && (buffers.color = _gl.createBuffer());
    let programAttributes = program.getAttributes();
    object.hasPositions && (_gl.bindBuffer(34962, buffers.position), _gl.bufferData(34962, object.positionArray, 35048), bindingStates.enableAttribute(programAttributes.position), _gl.vertexAttribPointer(programAttributes.position, 3, 5126, !1, 0, 0)), object.hasNormals && (_gl.bindBuffer(34962, buffers.normal), _gl.bufferData(34962, object.normalArray, 35048), bindingStates.enableAttribute(programAttributes.normal), _gl.vertexAttribPointer(programAttributes.normal, 3, 5126, !1, 0, 0)), object.hasUvs && (_gl.bindBuffer(34962, buffers.uv), _gl.bufferData(34962, object.uvArray, 35048), bindingStates.enableAttribute(programAttributes.uv), _gl.vertexAttribPointer(programAttributes.uv, 2, 5126, !1, 0, 0)), object.hasColors && (_gl.bindBuffer(34962, buffers.color), _gl.bufferData(34962, object.colorArray, 35048), bindingStates.enableAttribute(programAttributes.color), _gl.vertexAttribPointer(programAttributes.color, 3, 5126, !1, 0, 0)), bindingStates.disableUnusedAttributes(), _gl.drawArrays(4, 0, object.count), object.count = 0;
  }, this.renderBufferDirect = function(camera, scene, geometry, material, object, group) {
    scene === null && (scene = _emptyScene);
    let frontFaceCW = object.isMesh && object.matrixWorld.determinant() < 0, program = setProgram(camera, scene, material, object);
    state.setMaterial(material, frontFaceCW);
    let index = geometry.index, position = geometry.attributes.position;
    if (index === null) {
      if (position === void 0 || position.count === 0)
        return;
    } else if (index.count === 0)
      return;
    let rangeFactor = 1;
    material.wireframe === !0 && (index = geometries.getWireframeAttribute(geometry), rangeFactor = 2), (material.morphTargets || material.morphNormals) && morphtargets.update(object, geometry, material, program), bindingStates.setup(object, material, program, geometry, index);
    let attribute, renderer = bufferRenderer;
    index !== null && (attribute = attributes.get(index), renderer = indexedBufferRenderer, renderer.setIndex(attribute));
    let dataCount = index !== null ? index.count : position.count, rangeStart = geometry.drawRange.start * rangeFactor, rangeCount = geometry.drawRange.count * rangeFactor, groupStart = group !== null ? group.start * rangeFactor : 0, groupCount = group !== null ? group.count * rangeFactor : Infinity, drawStart = Math.max(rangeStart, groupStart), drawEnd = Math.min(dataCount, rangeStart + rangeCount, groupStart + groupCount) - 1, drawCount = Math.max(0, drawEnd - drawStart + 1);
    if (drawCount !== 0) {
      if (object.isMesh)
        material.wireframe === !0 ? (state.setLineWidth(material.wireframeLinewidth * getTargetPixelRatio()), renderer.setMode(1)) : renderer.setMode(4);
      else if (object.isLine) {
        let lineWidth = material.linewidth;
        lineWidth === void 0 && (lineWidth = 1), state.setLineWidth(lineWidth * getTargetPixelRatio()), object.isLineSegments ? renderer.setMode(1) : object.isLineLoop ? renderer.setMode(2) : renderer.setMode(3);
      } else
        object.isPoints ? renderer.setMode(0) : object.isSprite && renderer.setMode(4);
      if (object.isInstancedMesh)
        renderer.renderInstances(drawStart, drawCount, object.count);
      else if (geometry.isInstancedBufferGeometry) {
        let instanceCount = Math.min(geometry.instanceCount, geometry._maxInstanceCount);
        renderer.renderInstances(drawStart, drawCount, instanceCount);
      } else
        renderer.render(drawStart, drawCount);
    }
  }, this.compile = function(scene, camera) {
    currentRenderState = renderStates.get(scene), currentRenderState.init(), scene.traverseVisible(function(object) {
      object.isLight && object.layers.test(camera.layers) && (currentRenderState.pushLight(object), object.castShadow && currentRenderState.pushShadow(object));
    }), currentRenderState.setupLights(), scene.traverse(function(object) {
      let material = object.material;
      if (material)
        if (Array.isArray(material))
          for (let i = 0; i < material.length; i++) {
            let material2 = material[i];
            getProgram(material2, scene, object);
          }
        else
          getProgram(material, scene, object);
    });
  };
  let onAnimationFrameCallback = null;
  function onAnimationFrame(time) {
    onAnimationFrameCallback && onAnimationFrameCallback(time);
  }
  function onXRSessionStart() {
    animation.stop();
  }
  function onXRSessionEnd() {
    animation.start();
  }
  let animation = new WebGLAnimation();
  animation.setAnimationLoop(onAnimationFrame), typeof window != "undefined" && animation.setContext(window), this.setAnimationLoop = function(callback) {
    onAnimationFrameCallback = callback, xr.setAnimationLoop(callback), callback === null ? animation.stop() : animation.start();
  }, xr.addEventListener("sessionstart", onXRSessionStart), xr.addEventListener("sessionend", onXRSessionEnd), this.render = function(scene, camera) {
    if (camera !== void 0 && camera.isCamera !== !0) {
      console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");
      return;
    }
    if (_isContextLost === !0)
      return;
    scene.autoUpdate === !0 && scene.updateMatrixWorld(), camera.parent === null && camera.updateMatrixWorld(), xr.enabled === !0 && xr.isPresenting === !0 && (xr.cameraAutoUpdate === !0 && xr.updateCamera(camera), camera = xr.getCamera()), scene.isScene === !0 && scene.onBeforeRender(_this, scene, camera, _currentRenderTarget), currentRenderState = renderStates.get(scene, renderStateStack.length), currentRenderState.init(), renderStateStack.push(currentRenderState), _projScreenMatrix2.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), _frustum.setFromProjectionMatrix(_projScreenMatrix2), _localClippingEnabled = this.localClippingEnabled, _clippingEnabled = clipping.init(this.clippingPlanes, _localClippingEnabled, camera), currentRenderList = renderLists.get(scene, renderListStack.length), currentRenderList.init(), renderListStack.push(currentRenderList), projectObject(scene, camera, 0, _this.sortObjects), currentRenderList.finish(), _this.sortObjects === !0 && currentRenderList.sort(_opaqueSort, _transparentSort), _clippingEnabled === !0 && clipping.beginShadows();
    let shadowsArray = currentRenderState.state.shadowsArray;
    shadowMap.render(shadowsArray, scene, camera), currentRenderState.setupLights(), currentRenderState.setupLightsView(camera), _clippingEnabled === !0 && clipping.endShadows(), this.info.autoReset === !0 && this.info.reset(), background.render(currentRenderList, scene);
    let opaqueObjects = currentRenderList.opaque, transmissiveObjects = currentRenderList.transmissive, transparentObjects = currentRenderList.transparent;
    opaqueObjects.length > 0 && renderObjects(opaqueObjects, scene, camera), transmissiveObjects.length > 0 && renderTransmissiveObjects(opaqueObjects, transmissiveObjects, scene, camera), transparentObjects.length > 0 && renderObjects(transparentObjects, scene, camera), _currentRenderTarget !== null && (textures.updateRenderTargetMipmap(_currentRenderTarget), textures.updateMultisampleRenderTarget(_currentRenderTarget)), scene.isScene === !0 && scene.onAfterRender(_this, scene, camera), state.buffers.depth.setTest(!0), state.buffers.depth.setMask(!0), state.buffers.color.setMask(!0), state.setPolygonOffset(!1), bindingStates.resetDefaultState(), _currentMaterialId = -1, _currentCamera = null, renderStateStack.pop(), renderStateStack.length > 0 ? currentRenderState = renderStateStack[renderStateStack.length - 1] : currentRenderState = null, renderListStack.pop(), renderListStack.length > 0 ? currentRenderList = renderListStack[renderListStack.length - 1] : currentRenderList = null;
  };
  function projectObject(object, camera, groupOrder, sortObjects) {
    if (object.visible === !1)
      return;
    if (object.layers.test(camera.layers)) {
      if (object.isGroup)
        groupOrder = object.renderOrder;
      else if (object.isLOD)
        object.autoUpdate === !0 && object.update(camera);
      else if (object.isLight)
        currentRenderState.pushLight(object), object.castShadow && currentRenderState.pushShadow(object);
      else if (object.isSprite) {
        if (!object.frustumCulled || _frustum.intersectsSprite(object)) {
          sortObjects && _vector3.setFromMatrixPosition(object.matrixWorld).applyMatrix4(_projScreenMatrix2);
          let geometry = objects.update(object), material = object.material;
          material.visible && currentRenderList.push(object, geometry, material, groupOrder, _vector3.z, null);
        }
      } else if (object.isImmediateRenderObject)
        sortObjects && _vector3.setFromMatrixPosition(object.matrixWorld).applyMatrix4(_projScreenMatrix2), currentRenderList.push(object, null, object.material, groupOrder, _vector3.z, null);
      else if ((object.isMesh || object.isLine || object.isPoints) && (object.isSkinnedMesh && object.skeleton.frame !== info.render.frame && (object.skeleton.update(), object.skeleton.frame = info.render.frame), !object.frustumCulled || _frustum.intersectsObject(object))) {
        sortObjects && _vector3.setFromMatrixPosition(object.matrixWorld).applyMatrix4(_projScreenMatrix2);
        let geometry = objects.update(object), material = object.material;
        if (Array.isArray(material)) {
          let groups = geometry.groups;
          for (let i = 0, l = groups.length; i < l; i++) {
            let group = groups[i], groupMaterial = material[group.materialIndex];
            groupMaterial && groupMaterial.visible && currentRenderList.push(object, geometry, groupMaterial, groupOrder, _vector3.z, group);
          }
        } else
          material.visible && currentRenderList.push(object, geometry, material, groupOrder, _vector3.z, null);
      }
    }
    let children = object.children;
    for (let i = 0, l = children.length; i < l; i++)
      projectObject(children[i], camera, groupOrder, sortObjects);
  }
  function renderTransmissiveObjects(opaqueObjects, transmissiveObjects, scene, camera) {
    _transmissionRenderTarget === null && (_transmissionRenderTarget = new WebGLRenderTarget(1024, 1024, {
      generateMipmaps: !0,
      minFilter: LinearMipmapLinearFilter,
      magFilter: NearestFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping
    }));
    let currentRenderTarget = _this.getRenderTarget();
    _this.setRenderTarget(_transmissionRenderTarget), _this.clear(), renderObjects(opaqueObjects, scene, camera), textures.updateRenderTargetMipmap(_transmissionRenderTarget), _this.setRenderTarget(currentRenderTarget), renderObjects(transmissiveObjects, scene, camera);
  }
  function renderObjects(renderList, scene, camera) {
    let overrideMaterial = scene.isScene === !0 ? scene.overrideMaterial : null;
    for (let i = 0, l = renderList.length; i < l; i++) {
      let renderItem = renderList[i], object = renderItem.object, geometry = renderItem.geometry, material = overrideMaterial === null ? renderItem.material : overrideMaterial, group = renderItem.group;
      if (camera.isArrayCamera) {
        let cameras = camera.cameras;
        for (let j = 0, jl = cameras.length; j < jl; j++) {
          let camera2 = cameras[j];
          object.layers.test(camera2.layers) && (state.viewport(_currentViewport.copy(camera2.viewport)), currentRenderState.setupLightsView(camera2), renderObject(object, scene, camera2, geometry, material, group));
        }
      } else
        renderObject(object, scene, camera, geometry, material, group);
    }
  }
  function renderObject(object, scene, camera, geometry, material, group) {
    if (object.onBeforeRender(_this, scene, camera, geometry, material, group), object.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld), object.normalMatrix.getNormalMatrix(object.modelViewMatrix), object.isImmediateRenderObject) {
      let program = setProgram(camera, scene, material, object);
      state.setMaterial(material), bindingStates.reset(), renderObjectImmediate(object, program);
    } else
      _this.renderBufferDirect(camera, scene, geometry, material, object, group);
    object.onAfterRender(_this, scene, camera, geometry, material, group);
  }
  function getProgram(material, scene, object) {
    scene.isScene !== !0 && (scene = _emptyScene);
    let materialProperties = properties.get(material), lights = currentRenderState.state.lights, shadowsArray = currentRenderState.state.shadowsArray, lightsStateVersion = lights.state.version, parameters2 = programCache.getParameters(material, lights.state, shadowsArray, scene, object), programCacheKey = programCache.getProgramCacheKey(parameters2), programs = materialProperties.programs;
    materialProperties.environment = material.isMeshStandardMaterial ? scene.environment : null, materialProperties.fog = scene.fog, materialProperties.envMap = cubemaps.get(material.envMap || materialProperties.environment), programs === void 0 && (material.addEventListener("dispose", onMaterialDispose), programs = new Map(), materialProperties.programs = programs);
    let program = programs.get(programCacheKey);
    if (program !== void 0) {
      if (materialProperties.currentProgram === program && materialProperties.lightsStateVersion === lightsStateVersion)
        return updateCommonMaterialProperties(material, parameters2), program;
    } else
      parameters2.uniforms = programCache.getUniforms(material), material.onBuild(parameters2, _this), material.onBeforeCompile(parameters2, _this), program = programCache.acquireProgram(parameters2, programCacheKey), programs.set(programCacheKey, program), materialProperties.uniforms = parameters2.uniforms;
    let uniforms = materialProperties.uniforms;
    (!material.isShaderMaterial && !material.isRawShaderMaterial || material.clipping === !0) && (uniforms.clippingPlanes = clipping.uniform), updateCommonMaterialProperties(material, parameters2), materialProperties.needsLights = materialNeedsLights(material), materialProperties.lightsStateVersion = lightsStateVersion, materialProperties.needsLights && (uniforms.ambientLightColor.value = lights.state.ambient, uniforms.lightProbe.value = lights.state.probe, uniforms.directionalLights.value = lights.state.directional, uniforms.directionalLightShadows.value = lights.state.directionalShadow, uniforms.spotLights.value = lights.state.spot, uniforms.spotLightShadows.value = lights.state.spotShadow, uniforms.rectAreaLights.value = lights.state.rectArea, uniforms.ltc_1.value = lights.state.rectAreaLTC1, uniforms.ltc_2.value = lights.state.rectAreaLTC2, uniforms.pointLights.value = lights.state.point, uniforms.pointLightShadows.value = lights.state.pointShadow, uniforms.hemisphereLights.value = lights.state.hemi, uniforms.directionalShadowMap.value = lights.state.directionalShadowMap, uniforms.directionalShadowMatrix.value = lights.state.directionalShadowMatrix, uniforms.spotShadowMap.value = lights.state.spotShadowMap, uniforms.spotShadowMatrix.value = lights.state.spotShadowMatrix, uniforms.pointShadowMap.value = lights.state.pointShadowMap, uniforms.pointShadowMatrix.value = lights.state.pointShadowMatrix);
    let progUniforms = program.getUniforms(), uniformsList = WebGLUniforms.seqWithValue(progUniforms.seq, uniforms);
    return materialProperties.currentProgram = program, materialProperties.uniformsList = uniformsList, program;
  }
  function updateCommonMaterialProperties(material, parameters2) {
    let materialProperties = properties.get(material);
    materialProperties.outputEncoding = parameters2.outputEncoding, materialProperties.instancing = parameters2.instancing, materialProperties.skinning = parameters2.skinning, materialProperties.numClippingPlanes = parameters2.numClippingPlanes, materialProperties.numIntersection = parameters2.numClipIntersection, materialProperties.vertexAlphas = parameters2.vertexAlphas;
  }
  function setProgram(camera, scene, material, object) {
    scene.isScene !== !0 && (scene = _emptyScene), textures.resetTextureUnits();
    let fog = scene.fog, environment = material.isMeshStandardMaterial ? scene.environment : null, encoding = _currentRenderTarget === null ? _this.outputEncoding : _currentRenderTarget.texture.encoding, envMap = cubemaps.get(material.envMap || environment), vertexAlphas = material.vertexColors === !0 && object.geometry && object.geometry.attributes.color && object.geometry.attributes.color.itemSize === 4, materialProperties = properties.get(material), lights = currentRenderState.state.lights;
    if (_clippingEnabled === !0 && (_localClippingEnabled === !0 || camera !== _currentCamera)) {
      let useCache = camera === _currentCamera && material.id === _currentMaterialId;
      clipping.setState(material, camera, useCache);
    }
    let needsProgramChange = !1;
    material.version === materialProperties.__version ? (materialProperties.needsLights && materialProperties.lightsStateVersion !== lights.state.version || materialProperties.outputEncoding !== encoding || object.isInstancedMesh && materialProperties.instancing === !1 || !object.isInstancedMesh && materialProperties.instancing === !0 || object.isSkinnedMesh && materialProperties.skinning === !1 || !object.isSkinnedMesh && materialProperties.skinning === !0 || materialProperties.envMap !== envMap || material.fog && materialProperties.fog !== fog || materialProperties.numClippingPlanes !== void 0 && (materialProperties.numClippingPlanes !== clipping.numPlanes || materialProperties.numIntersection !== clipping.numIntersection) || materialProperties.vertexAlphas !== vertexAlphas) && (needsProgramChange = !0) : (needsProgramChange = !0, materialProperties.__version = material.version);
    let program = materialProperties.currentProgram;
    needsProgramChange === !0 && (program = getProgram(material, scene, object));
    let refreshProgram = !1, refreshMaterial = !1, refreshLights = !1, p_uniforms = program.getUniforms(), m_uniforms = materialProperties.uniforms;
    if (state.useProgram(program.program) && (refreshProgram = !0, refreshMaterial = !0, refreshLights = !0), material.id !== _currentMaterialId && (_currentMaterialId = material.id, refreshMaterial = !0), refreshProgram || _currentCamera !== camera) {
      if (p_uniforms.setValue(_gl, "projectionMatrix", camera.projectionMatrix), capabilities.logarithmicDepthBuffer && p_uniforms.setValue(_gl, "logDepthBufFC", 2 / (Math.log(camera.far + 1) / Math.LN2)), _currentCamera !== camera && (_currentCamera = camera, refreshMaterial = !0, refreshLights = !0), material.isShaderMaterial || material.isMeshPhongMaterial || material.isMeshToonMaterial || material.isMeshStandardMaterial || material.envMap) {
        let uCamPos = p_uniforms.map.cameraPosition;
        uCamPos !== void 0 && uCamPos.setValue(_gl, _vector3.setFromMatrixPosition(camera.matrixWorld));
      }
      (material.isMeshPhongMaterial || material.isMeshToonMaterial || material.isMeshLambertMaterial || material.isMeshBasicMaterial || material.isMeshStandardMaterial || material.isShaderMaterial) && p_uniforms.setValue(_gl, "isOrthographic", camera.isOrthographicCamera === !0), (material.isMeshPhongMaterial || material.isMeshToonMaterial || material.isMeshLambertMaterial || material.isMeshBasicMaterial || material.isMeshStandardMaterial || material.isShaderMaterial || material.isShadowMaterial || object.isSkinnedMesh) && p_uniforms.setValue(_gl, "viewMatrix", camera.matrixWorldInverse);
    }
    if (object.isSkinnedMesh) {
      p_uniforms.setOptional(_gl, object, "bindMatrix"), p_uniforms.setOptional(_gl, object, "bindMatrixInverse");
      let skeleton = object.skeleton;
      skeleton && (capabilities.floatVertexTextures ? (skeleton.boneTexture === null && skeleton.computeBoneTexture(), p_uniforms.setValue(_gl, "boneTexture", skeleton.boneTexture, textures), p_uniforms.setValue(_gl, "boneTextureSize", skeleton.boneTextureSize)) : p_uniforms.setOptional(_gl, skeleton, "boneMatrices"));
    }
    return (refreshMaterial || materialProperties.receiveShadow !== object.receiveShadow) && (materialProperties.receiveShadow = object.receiveShadow, p_uniforms.setValue(_gl, "receiveShadow", object.receiveShadow)), refreshMaterial && (p_uniforms.setValue(_gl, "toneMappingExposure", _this.toneMappingExposure), materialProperties.needsLights && markUniformsLightsNeedsUpdate(m_uniforms, refreshLights), fog && material.fog && materials.refreshFogUniforms(m_uniforms, fog), materials.refreshMaterialUniforms(m_uniforms, material, _pixelRatio, _height, _transmissionRenderTarget), WebGLUniforms.upload(_gl, materialProperties.uniformsList, m_uniforms, textures)), material.isShaderMaterial && material.uniformsNeedUpdate === !0 && (WebGLUniforms.upload(_gl, materialProperties.uniformsList, m_uniforms, textures), material.uniformsNeedUpdate = !1), material.isSpriteMaterial && p_uniforms.setValue(_gl, "center", object.center), p_uniforms.setValue(_gl, "modelViewMatrix", object.modelViewMatrix), p_uniforms.setValue(_gl, "normalMatrix", object.normalMatrix), p_uniforms.setValue(_gl, "modelMatrix", object.matrixWorld), program;
  }
  function markUniformsLightsNeedsUpdate(uniforms, value) {
    uniforms.ambientLightColor.needsUpdate = value, uniforms.lightProbe.needsUpdate = value, uniforms.directionalLights.needsUpdate = value, uniforms.directionalLightShadows.needsUpdate = value, uniforms.pointLights.needsUpdate = value, uniforms.pointLightShadows.needsUpdate = value, uniforms.spotLights.needsUpdate = value, uniforms.spotLightShadows.needsUpdate = value, uniforms.rectAreaLights.needsUpdate = value, uniforms.hemisphereLights.needsUpdate = value;
  }
  function materialNeedsLights(material) {
    return material.isMeshLambertMaterial || material.isMeshToonMaterial || material.isMeshPhongMaterial || material.isMeshStandardMaterial || material.isShadowMaterial || material.isShaderMaterial && material.lights === !0;
  }
  this.getActiveCubeFace = function() {
    return _currentActiveCubeFace;
  }, this.getActiveMipmapLevel = function() {
    return _currentActiveMipmapLevel;
  }, this.getRenderTarget = function() {
    return _currentRenderTarget;
  }, this.setRenderTarget = function(renderTarget, activeCubeFace = 0, activeMipmapLevel = 0) {
    _currentRenderTarget = renderTarget, _currentActiveCubeFace = activeCubeFace, _currentActiveMipmapLevel = activeMipmapLevel, renderTarget && properties.get(renderTarget).__webglFramebuffer === void 0 && textures.setupRenderTarget(renderTarget);
    let framebuffer = null, isCube = !1, isRenderTarget3D = !1;
    if (renderTarget) {
      let texture = renderTarget.texture;
      (texture.isDataTexture3D || texture.isDataTexture2DArray) && (isRenderTarget3D = !0);
      let __webglFramebuffer = properties.get(renderTarget).__webglFramebuffer;
      renderTarget.isWebGLCubeRenderTarget ? (framebuffer = __webglFramebuffer[activeCubeFace], isCube = !0) : renderTarget.isWebGLMultisampleRenderTarget ? framebuffer = properties.get(renderTarget).__webglMultisampledFramebuffer : framebuffer = __webglFramebuffer, _currentViewport.copy(renderTarget.viewport), _currentScissor.copy(renderTarget.scissor), _currentScissorTest = renderTarget.scissorTest;
    } else
      _currentViewport.copy(_viewport).multiplyScalar(_pixelRatio).floor(), _currentScissor.copy(_scissor).multiplyScalar(_pixelRatio).floor(), _currentScissorTest = _scissorTest;
    if (state.bindFramebuffer(36160, framebuffer) && capabilities.drawBuffers) {
      let needsUpdate = !1;
      if (renderTarget)
        if (renderTarget.isWebGLMultipleRenderTargets) {
          let textures2 = renderTarget.texture;
          if (_currentDrawBuffers.length !== textures2.length || _currentDrawBuffers[0] !== 36064) {
            for (let i = 0, il = textures2.length; i < il; i++)
              _currentDrawBuffers[i] = 36064 + i;
            _currentDrawBuffers.length = textures2.length, needsUpdate = !0;
          }
        } else
          (_currentDrawBuffers.length !== 1 || _currentDrawBuffers[0] !== 36064) && (_currentDrawBuffers[0] = 36064, _currentDrawBuffers.length = 1, needsUpdate = !0);
      else
        (_currentDrawBuffers.length !== 1 || _currentDrawBuffers[0] !== 1029) && (_currentDrawBuffers[0] = 1029, _currentDrawBuffers.length = 1, needsUpdate = !0);
      needsUpdate && (capabilities.isWebGL2 ? _gl.drawBuffers(_currentDrawBuffers) : extensions.get("WEBGL_draw_buffers").drawBuffersWEBGL(_currentDrawBuffers));
    }
    if (state.viewport(_currentViewport), state.scissor(_currentScissor), state.setScissorTest(_currentScissorTest), isCube) {
      let textureProperties = properties.get(renderTarget.texture);
      _gl.framebufferTexture2D(36160, 36064, 34069 + activeCubeFace, textureProperties.__webglTexture, activeMipmapLevel);
    } else if (isRenderTarget3D) {
      let textureProperties = properties.get(renderTarget.texture), layer = activeCubeFace || 0;
      _gl.framebufferTextureLayer(36160, 36064, textureProperties.__webglTexture, activeMipmapLevel || 0, layer);
    }
  }, this.readRenderTargetPixels = function(renderTarget, x, y, width, height, buffer, activeCubeFaceIndex) {
    if (!(renderTarget && renderTarget.isWebGLRenderTarget)) {
      console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");
      return;
    }
    let framebuffer = properties.get(renderTarget).__webglFramebuffer;
    if (renderTarget.isWebGLCubeRenderTarget && activeCubeFaceIndex !== void 0 && (framebuffer = framebuffer[activeCubeFaceIndex]), framebuffer) {
      state.bindFramebuffer(36160, framebuffer);
      try {
        let texture = renderTarget.texture, textureFormat = texture.format, textureType = texture.type;
        if (textureFormat !== RGBAFormat && utils.convert(textureFormat) !== _gl.getParameter(35739)) {
          console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");
          return;
        }
        let halfFloatSupportedByExt = textureType === HalfFloatType && (extensions.has("EXT_color_buffer_half_float") || capabilities.isWebGL2 && extensions.has("EXT_color_buffer_float"));
        if (textureType !== UnsignedByteType && utils.convert(textureType) !== _gl.getParameter(35738) && !(textureType === FloatType && (capabilities.isWebGL2 || extensions.has("OES_texture_float") || extensions.has("WEBGL_color_buffer_float"))) && !halfFloatSupportedByExt) {
          console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");
          return;
        }
        _gl.checkFramebufferStatus(36160) === 36053 ? x >= 0 && x <= renderTarget.width - width && y >= 0 && y <= renderTarget.height - height && _gl.readPixels(x, y, width, height, utils.convert(textureFormat), utils.convert(textureType), buffer) : console.error("THREE.WebGLRenderer.readRenderTargetPixels: readPixels from renderTarget failed. Framebuffer not complete.");
      } finally {
        let framebuffer2 = _currentRenderTarget !== null ? properties.get(_currentRenderTarget).__webglFramebuffer : null;
        state.bindFramebuffer(36160, framebuffer2);
      }
    }
  }, this.copyFramebufferToTexture = function(position, texture, level = 0) {
    let levelScale = Math.pow(2, -level), width = Math.floor(texture.image.width * levelScale), height = Math.floor(texture.image.height * levelScale), glFormat = utils.convert(texture.format);
    capabilities.isWebGL2 && (glFormat === 6407 && (glFormat = 32849), glFormat === 6408 && (glFormat = 32856)), textures.setTexture2D(texture, 0), _gl.copyTexImage2D(3553, level, glFormat, position.x, position.y, width, height, 0), state.unbindTexture();
  }, this.copyTextureToTexture = function(position, srcTexture, dstTexture, level = 0) {
    let width = srcTexture.image.width, height = srcTexture.image.height, glFormat = utils.convert(dstTexture.format), glType = utils.convert(dstTexture.type);
    textures.setTexture2D(dstTexture, 0), _gl.pixelStorei(37440, dstTexture.flipY), _gl.pixelStorei(37441, dstTexture.premultiplyAlpha), _gl.pixelStorei(3317, dstTexture.unpackAlignment), srcTexture.isDataTexture ? _gl.texSubImage2D(3553, level, position.x, position.y, width, height, glFormat, glType, srcTexture.image.data) : srcTexture.isCompressedTexture ? _gl.compressedTexSubImage2D(3553, level, position.x, position.y, srcTexture.mipmaps[0].width, srcTexture.mipmaps[0].height, glFormat, srcTexture.mipmaps[0].data) : _gl.texSubImage2D(3553, level, position.x, position.y, glFormat, glType, srcTexture.image), level === 0 && dstTexture.generateMipmaps && _gl.generateMipmap(3553), state.unbindTexture();
  }, this.copyTextureToTexture3D = function(sourceBox, position, srcTexture, dstTexture, level = 0) {
    if (_this.isWebGL1Renderer) {
      console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: can only be used with WebGL2.");
      return;
    }
    let { width, height, data } = srcTexture.image, glFormat = utils.convert(dstTexture.format), glType = utils.convert(dstTexture.type), glTarget;
    if (dstTexture.isDataTexture3D)
      textures.setTexture3D(dstTexture, 0), glTarget = 32879;
    else if (dstTexture.isDataTexture2DArray)
      textures.setTexture2DArray(dstTexture, 0), glTarget = 35866;
    else {
      console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: only supports THREE.DataTexture3D and THREE.DataTexture2DArray.");
      return;
    }
    _gl.pixelStorei(37440, dstTexture.flipY), _gl.pixelStorei(37441, dstTexture.premultiplyAlpha), _gl.pixelStorei(3317, dstTexture.unpackAlignment);
    let unpackRowLen = _gl.getParameter(3314), unpackImageHeight = _gl.getParameter(32878), unpackSkipPixels = _gl.getParameter(3316), unpackSkipRows = _gl.getParameter(3315), unpackSkipImages = _gl.getParameter(32877);
    _gl.pixelStorei(3314, width), _gl.pixelStorei(32878, height), _gl.pixelStorei(3316, sourceBox.min.x), _gl.pixelStorei(3315, sourceBox.min.y), _gl.pixelStorei(32877, sourceBox.min.z), _gl.texSubImage3D(glTarget, level, position.x, position.y, position.z, sourceBox.max.x - sourceBox.min.x + 1, sourceBox.max.y - sourceBox.min.y + 1, sourceBox.max.z - sourceBox.min.z + 1, glFormat, glType, data), _gl.pixelStorei(3314, unpackRowLen), _gl.pixelStorei(32878, unpackImageHeight), _gl.pixelStorei(3316, unpackSkipPixels), _gl.pixelStorei(3315, unpackSkipRows), _gl.pixelStorei(32877, unpackSkipImages), level === 0 && dstTexture.generateMipmaps && _gl.generateMipmap(glTarget), state.unbindTexture();
  }, this.initTexture = function(texture) {
    textures.setTexture2D(texture, 0), state.unbindTexture();
  }, this.resetState = function() {
    _currentActiveCubeFace = 0, _currentActiveMipmapLevel = 0, _currentRenderTarget = null, state.reset(), bindingStates.reset();
  }, typeof __THREE_DEVTOOLS__ != "undefined" && __THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe", { detail: this }));
}
var WebGL1Renderer = class extends WebGLRenderer {
};
WebGL1Renderer.prototype.isWebGL1Renderer = !0;
var FogExp2 = class {
  constructor(color, density = 25e-5) {
    this.name = "", this.color = new Color(color), this.density = density;
  }
  clone() {
    return new FogExp2(this.color, this.density);
  }
  toJSON() {
    return {
      type: "FogExp2",
      color: this.color.getHex(),
      density: this.density
    };
  }
};
FogExp2.prototype.isFogExp2 = !0;
var Fog = class {
  constructor(color, near = 1, far = 1e3) {
    this.name = "", this.color = new Color(color), this.near = near, this.far = far;
  }
  clone() {
    return new Fog(this.color, this.near, this.far);
  }
  toJSON() {
    return {
      type: "Fog",
      color: this.color.getHex(),
      near: this.near,
      far: this.far
    };
  }
};
Fog.prototype.isFog = !0;
var Scene = class extends Object3D {
  constructor() {
    super();
    this.type = "Scene", this.background = null, this.environment = null, this.fog = null, this.overrideMaterial = null, this.autoUpdate = !0, typeof __THREE_DEVTOOLS__ != "undefined" && __THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe", { detail: this }));
  }
  copy(source, recursive) {
    return super.copy(source, recursive), source.background !== null && (this.background = source.background.clone()), source.environment !== null && (this.environment = source.environment.clone()), source.fog !== null && (this.fog = source.fog.clone()), source.overrideMaterial !== null && (this.overrideMaterial = source.overrideMaterial.clone()), this.autoUpdate = source.autoUpdate, this.matrixAutoUpdate = source.matrixAutoUpdate, this;
  }
  toJSON(meta) {
    let data = super.toJSON(meta);
    return this.background !== null && (data.object.background = this.background.toJSON(meta)), this.environment !== null && (data.object.environment = this.environment.toJSON(meta)), this.fog !== null && (data.object.fog = this.fog.toJSON()), data;
  }
};
Scene.prototype.isScene = !0;
var InterleavedBuffer = class {
  constructor(array, stride) {
    this.array = array, this.stride = stride, this.count = array !== void 0 ? array.length / stride : 0, this.usage = StaticDrawUsage, this.updateRange = { offset: 0, count: -1 }, this.version = 0, this.uuid = generateUUID();
  }
  onUploadCallback() {
  }
  set needsUpdate(value) {
    value === !0 && this.version++;
  }
  setUsage(value) {
    return this.usage = value, this;
  }
  copy(source) {
    return this.array = new source.array.constructor(source.array), this.count = source.count, this.stride = source.stride, this.usage = source.usage, this;
  }
  copyAt(index1, attribute, index2) {
    index1 *= this.stride, index2 *= attribute.stride;
    for (let i = 0, l = this.stride; i < l; i++)
      this.array[index1 + i] = attribute.array[index2 + i];
    return this;
  }
  set(value, offset = 0) {
    return this.array.set(value, offset), this;
  }
  clone(data) {
    data.arrayBuffers === void 0 && (data.arrayBuffers = {}), this.array.buffer._uuid === void 0 && (this.array.buffer._uuid = generateUUID()), data.arrayBuffers[this.array.buffer._uuid] === void 0 && (data.arrayBuffers[this.array.buffer._uuid] = this.array.slice(0).buffer);
    let array = new this.array.constructor(data.arrayBuffers[this.array.buffer._uuid]), ib = new this.constructor(array, this.stride);
    return ib.setUsage(this.usage), ib;
  }
  onUpload(callback) {
    return this.onUploadCallback = callback, this;
  }
  toJSON(data) {
    return data.arrayBuffers === void 0 && (data.arrayBuffers = {}), this.array.buffer._uuid === void 0 && (this.array.buffer._uuid = generateUUID()), data.arrayBuffers[this.array.buffer._uuid] === void 0 && (data.arrayBuffers[this.array.buffer._uuid] = Array.prototype.slice.call(new Uint32Array(this.array.buffer))), {
      uuid: this.uuid,
      buffer: this.array.buffer._uuid,
      type: this.array.constructor.name,
      stride: this.stride
    };
  }
};
InterleavedBuffer.prototype.isInterleavedBuffer = !0;
var _vector$6 = /* @__PURE__ */ new Vector3(), InterleavedBufferAttribute = class {
  constructor(interleavedBuffer, itemSize, offset, normalized) {
    this.name = "", this.data = interleavedBuffer, this.itemSize = itemSize, this.offset = offset, this.normalized = normalized === !0;
  }
  get count() {
    return this.data.count;
  }
  get array() {
    return this.data.array;
  }
  set needsUpdate(value) {
    this.data.needsUpdate = value;
  }
  applyMatrix4(m) {
    for (let i = 0, l = this.data.count; i < l; i++)
      _vector$6.x = this.getX(i), _vector$6.y = this.getY(i), _vector$6.z = this.getZ(i), _vector$6.applyMatrix4(m), this.setXYZ(i, _vector$6.x, _vector$6.y, _vector$6.z);
    return this;
  }
  applyNormalMatrix(m) {
    for (let i = 0, l = this.count; i < l; i++)
      _vector$6.x = this.getX(i), _vector$6.y = this.getY(i), _vector$6.z = this.getZ(i), _vector$6.applyNormalMatrix(m), this.setXYZ(i, _vector$6.x, _vector$6.y, _vector$6.z);
    return this;
  }
  transformDirection(m) {
    for (let i = 0, l = this.count; i < l; i++)
      _vector$6.x = this.getX(i), _vector$6.y = this.getY(i), _vector$6.z = this.getZ(i), _vector$6.transformDirection(m), this.setXYZ(i, _vector$6.x, _vector$6.y, _vector$6.z);
    return this;
  }
  setX(index, x) {
    return this.data.array[index * this.data.stride + this.offset] = x, this;
  }
  setY(index, y) {
    return this.data.array[index * this.data.stride + this.offset + 1] = y, this;
  }
  setZ(index, z) {
    return this.data.array[index * this.data.stride + this.offset + 2] = z, this;
  }
  setW(index, w) {
    return this.data.array[index * this.data.stride + this.offset + 3] = w, this;
  }
  getX(index) {
    return this.data.array[index * this.data.stride + this.offset];
  }
  getY(index) {
    return this.data.array[index * this.data.stride + this.offset + 1];
  }
  getZ(index) {
    return this.data.array[index * this.data.stride + this.offset + 2];
  }
  getW(index) {
    return this.data.array[index * this.data.stride + this.offset + 3];
  }
  setXY(index, x, y) {
    return index = index * this.data.stride + this.offset, this.data.array[index + 0] = x, this.data.array[index + 1] = y, this;
  }
  setXYZ(index, x, y, z) {
    return index = index * this.data.stride + this.offset, this.data.array[index + 0] = x, this.data.array[index + 1] = y, this.data.array[index + 2] = z, this;
  }
  setXYZW(index, x, y, z, w) {
    return index = index * this.data.stride + this.offset, this.data.array[index + 0] = x, this.data.array[index + 1] = y, this.data.array[index + 2] = z, this.data.array[index + 3] = w, this;
  }
  clone(data) {
    if (data === void 0) {
      console.log("THREE.InterleavedBufferAttribute.clone(): Cloning an interlaved buffer attribute will deinterleave buffer data.");
      let array = [];
      for (let i = 0; i < this.count; i++) {
        let index = i * this.data.stride + this.offset;
        for (let j = 0; j < this.itemSize; j++)
          array.push(this.data.array[index + j]);
      }
      return new BufferAttribute(new this.array.constructor(array), this.itemSize, this.normalized);
    } else
      return data.interleavedBuffers === void 0 && (data.interleavedBuffers = {}), data.interleavedBuffers[this.data.uuid] === void 0 && (data.interleavedBuffers[this.data.uuid] = this.data.clone(data)), new InterleavedBufferAttribute(data.interleavedBuffers[this.data.uuid], this.itemSize, this.offset, this.normalized);
  }
  toJSON(data) {
    if (data === void 0) {
      console.log("THREE.InterleavedBufferAttribute.toJSON(): Serializing an interlaved buffer attribute will deinterleave buffer data.");
      let array = [];
      for (let i = 0; i < this.count; i++) {
        let index = i * this.data.stride + this.offset;
        for (let j = 0; j < this.itemSize; j++)
          array.push(this.data.array[index + j]);
      }
      return {
        itemSize: this.itemSize,
        type: this.array.constructor.name,
        array,
        normalized: this.normalized
      };
    } else
      return data.interleavedBuffers === void 0 && (data.interleavedBuffers = {}), data.interleavedBuffers[this.data.uuid] === void 0 && (data.interleavedBuffers[this.data.uuid] = this.data.toJSON(data)), {
        isInterleavedBufferAttribute: !0,
        itemSize: this.itemSize,
        data: this.data.uuid,
        offset: this.offset,
        normalized: this.normalized
      };
  }
};
InterleavedBufferAttribute.prototype.isInterleavedBufferAttribute = !0;
var SpriteMaterial = class extends Material {
  constructor(parameters) {
    super();
    this.type = "SpriteMaterial", this.color = new Color(16777215), this.map = null, this.alphaMap = null, this.rotation = 0, this.sizeAttenuation = !0, this.transparent = !0, this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.color.copy(source.color), this.map = source.map, this.alphaMap = source.alphaMap, this.rotation = source.rotation, this.sizeAttenuation = source.sizeAttenuation, this;
  }
};
SpriteMaterial.prototype.isSpriteMaterial = !0;
var _geometry, _intersectPoint = /* @__PURE__ */ new Vector3(), _worldScale = /* @__PURE__ */ new Vector3(), _mvPosition = /* @__PURE__ */ new Vector3(), _alignedPosition = /* @__PURE__ */ new Vector2(), _rotatedPosition = /* @__PURE__ */ new Vector2(), _viewWorldMatrix = /* @__PURE__ */ new Matrix4(), _vA = /* @__PURE__ */ new Vector3(), _vB = /* @__PURE__ */ new Vector3(), _vC = /* @__PURE__ */ new Vector3(), _uvA = /* @__PURE__ */ new Vector2(), _uvB = /* @__PURE__ */ new Vector2(), _uvC = /* @__PURE__ */ new Vector2(), Sprite = class extends Object3D {
  constructor(material) {
    super();
    if (this.type = "Sprite", _geometry === void 0) {
      _geometry = new BufferGeometry();
      let float32Array = new Float32Array([
        -0.5,
        -0.5,
        0,
        0,
        0,
        0.5,
        -0.5,
        0,
        1,
        0,
        0.5,
        0.5,
        0,
        1,
        1,
        -0.5,
        0.5,
        0,
        0,
        1
      ]), interleavedBuffer = new InterleavedBuffer(float32Array, 5);
      _geometry.setIndex([0, 1, 2, 0, 2, 3]), _geometry.setAttribute("position", new InterleavedBufferAttribute(interleavedBuffer, 3, 0, !1)), _geometry.setAttribute("uv", new InterleavedBufferAttribute(interleavedBuffer, 2, 3, !1));
    }
    this.geometry = _geometry, this.material = material !== void 0 ? material : new SpriteMaterial(), this.center = new Vector2(0.5, 0.5);
  }
  raycast(raycaster, intersects2) {
    raycaster.camera === null && console.error('THREE.Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'), _worldScale.setFromMatrixScale(this.matrixWorld), _viewWorldMatrix.copy(raycaster.camera.matrixWorld), this.modelViewMatrix.multiplyMatrices(raycaster.camera.matrixWorldInverse, this.matrixWorld), _mvPosition.setFromMatrixPosition(this.modelViewMatrix), raycaster.camera.isPerspectiveCamera && this.material.sizeAttenuation === !1 && _worldScale.multiplyScalar(-_mvPosition.z);
    let rotation = this.material.rotation, sin, cos;
    rotation !== 0 && (cos = Math.cos(rotation), sin = Math.sin(rotation));
    let center = this.center;
    transformVertex(_vA.set(-0.5, -0.5, 0), _mvPosition, center, _worldScale, sin, cos), transformVertex(_vB.set(0.5, -0.5, 0), _mvPosition, center, _worldScale, sin, cos), transformVertex(_vC.set(0.5, 0.5, 0), _mvPosition, center, _worldScale, sin, cos), _uvA.set(0, 0), _uvB.set(1, 0), _uvC.set(1, 1);
    let intersect = raycaster.ray.intersectTriangle(_vA, _vB, _vC, !1, _intersectPoint);
    if (intersect === null && (transformVertex(_vB.set(-0.5, 0.5, 0), _mvPosition, center, _worldScale, sin, cos), _uvB.set(0, 1), intersect = raycaster.ray.intersectTriangle(_vA, _vC, _vB, !1, _intersectPoint), intersect === null))
      return;
    let distance = raycaster.ray.origin.distanceTo(_intersectPoint);
    distance < raycaster.near || distance > raycaster.far || intersects2.push({
      distance,
      point: _intersectPoint.clone(),
      uv: Triangle.getUV(_intersectPoint, _vA, _vB, _vC, _uvA, _uvB, _uvC, new Vector2()),
      face: null,
      object: this
    });
  }
  copy(source) {
    return super.copy(source), source.center !== void 0 && this.center.copy(source.center), this.material = source.material, this;
  }
};
Sprite.prototype.isSprite = !0;
function transformVertex(vertexPosition, mvPosition, center, scale, sin, cos) {
  _alignedPosition.subVectors(vertexPosition, center).addScalar(0.5).multiply(scale), sin !== void 0 ? (_rotatedPosition.x = cos * _alignedPosition.x - sin * _alignedPosition.y, _rotatedPosition.y = sin * _alignedPosition.x + cos * _alignedPosition.y) : _rotatedPosition.copy(_alignedPosition), vertexPosition.copy(mvPosition), vertexPosition.x += _rotatedPosition.x, vertexPosition.y += _rotatedPosition.y, vertexPosition.applyMatrix4(_viewWorldMatrix);
}
var _basePosition = /* @__PURE__ */ new Vector3(), _skinIndex = /* @__PURE__ */ new Vector4(), _skinWeight = /* @__PURE__ */ new Vector4(), _vector$5 = /* @__PURE__ */ new Vector3(), _matrix = /* @__PURE__ */ new Matrix4(), SkinnedMesh = class extends Mesh {
  constructor(geometry, material) {
    super(geometry, material);
    this.type = "SkinnedMesh", this.bindMode = "attached", this.bindMatrix = new Matrix4(), this.bindMatrixInverse = new Matrix4();
  }
  copy(source) {
    return super.copy(source), this.bindMode = source.bindMode, this.bindMatrix.copy(source.bindMatrix), this.bindMatrixInverse.copy(source.bindMatrixInverse), this.skeleton = source.skeleton, this;
  }
  bind(skeleton, bindMatrix) {
    this.skeleton = skeleton, bindMatrix === void 0 && (this.updateMatrixWorld(!0), this.skeleton.calculateInverses(), bindMatrix = this.matrixWorld), this.bindMatrix.copy(bindMatrix), this.bindMatrixInverse.copy(bindMatrix).invert();
  }
  pose() {
    this.skeleton.pose();
  }
  normalizeSkinWeights() {
    let vector = new Vector4(), skinWeight = this.geometry.attributes.skinWeight;
    for (let i = 0, l = skinWeight.count; i < l; i++) {
      vector.x = skinWeight.getX(i), vector.y = skinWeight.getY(i), vector.z = skinWeight.getZ(i), vector.w = skinWeight.getW(i);
      let scale = 1 / vector.manhattanLength();
      scale !== Infinity ? vector.multiplyScalar(scale) : vector.set(1, 0, 0, 0), skinWeight.setXYZW(i, vector.x, vector.y, vector.z, vector.w);
    }
  }
  updateMatrixWorld(force) {
    super.updateMatrixWorld(force), this.bindMode === "attached" ? this.bindMatrixInverse.copy(this.matrixWorld).invert() : this.bindMode === "detached" ? this.bindMatrixInverse.copy(this.bindMatrix).invert() : console.warn("THREE.SkinnedMesh: Unrecognized bindMode: " + this.bindMode);
  }
  boneTransform(index, target) {
    let skeleton = this.skeleton, geometry = this.geometry;
    _skinIndex.fromBufferAttribute(geometry.attributes.skinIndex, index), _skinWeight.fromBufferAttribute(geometry.attributes.skinWeight, index), _basePosition.fromBufferAttribute(geometry.attributes.position, index).applyMatrix4(this.bindMatrix), target.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      let weight = _skinWeight.getComponent(i);
      if (weight !== 0) {
        let boneIndex = _skinIndex.getComponent(i);
        _matrix.multiplyMatrices(skeleton.bones[boneIndex].matrixWorld, skeleton.boneInverses[boneIndex]), target.addScaledVector(_vector$5.copy(_basePosition).applyMatrix4(_matrix), weight);
      }
    }
    return target.applyMatrix4(this.bindMatrixInverse);
  }
};
SkinnedMesh.prototype.isSkinnedMesh = !0;
var Bone = class extends Object3D {
  constructor() {
    super();
    this.type = "Bone";
  }
};
Bone.prototype.isBone = !0;
var DataTexture = class extends Texture {
  constructor(data, width, height, format, type, mapping, wrapS, wrapT, magFilter, minFilter, anisotropy, encoding) {
    super(null, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy, encoding);
    this.image = { data: data || null, width: width || 1, height: height || 1 }, this.magFilter = magFilter !== void 0 ? magFilter : NearestFilter, this.minFilter = minFilter !== void 0 ? minFilter : NearestFilter, this.generateMipmaps = !1, this.flipY = !1, this.unpackAlignment = 1, this.needsUpdate = !0;
  }
};
DataTexture.prototype.isDataTexture = !0;
var _instanceLocalMatrix = /* @__PURE__ */ new Matrix4(), _instanceWorldMatrix = /* @__PURE__ */ new Matrix4(), _instanceIntersects = [], _mesh = /* @__PURE__ */ new Mesh(), InstancedMesh = class extends Mesh {
  constructor(geometry, material, count) {
    super(geometry, material);
    this.instanceMatrix = new BufferAttribute(new Float32Array(count * 16), 16), this.instanceColor = null, this.count = count, this.frustumCulled = !1;
  }
  copy(source) {
    return super.copy(source), this.instanceMatrix.copy(source.instanceMatrix), source.instanceColor !== null && (this.instanceColor = source.instanceColor.clone()), this.count = source.count, this;
  }
  getColorAt(index, color) {
    color.fromArray(this.instanceColor.array, index * 3);
  }
  getMatrixAt(index, matrix) {
    matrix.fromArray(this.instanceMatrix.array, index * 16);
  }
  raycast(raycaster, intersects2) {
    let matrixWorld = this.matrixWorld, raycastTimes = this.count;
    if (_mesh.geometry = this.geometry, _mesh.material = this.material, _mesh.material !== void 0)
      for (let instanceId = 0; instanceId < raycastTimes; instanceId++) {
        this.getMatrixAt(instanceId, _instanceLocalMatrix), _instanceWorldMatrix.multiplyMatrices(matrixWorld, _instanceLocalMatrix), _mesh.matrixWorld = _instanceWorldMatrix, _mesh.raycast(raycaster, _instanceIntersects);
        for (let i = 0, l = _instanceIntersects.length; i < l; i++) {
          let intersect = _instanceIntersects[i];
          intersect.instanceId = instanceId, intersect.object = this, intersects2.push(intersect);
        }
        _instanceIntersects.length = 0;
      }
  }
  setColorAt(index, color) {
    this.instanceColor === null && (this.instanceColor = new BufferAttribute(new Float32Array(this.count * 3), 3)), color.toArray(this.instanceColor.array, index * 3);
  }
  setMatrixAt(index, matrix) {
    matrix.toArray(this.instanceMatrix.array, index * 16);
  }
  updateMorphTargets() {
  }
  dispose() {
    this.dispatchEvent({ type: "dispose" });
  }
};
InstancedMesh.prototype.isInstancedMesh = !0;
var LineBasicMaterial = class extends Material {
  constructor(parameters) {
    super();
    this.type = "LineBasicMaterial", this.color = new Color(16777215), this.linewidth = 1, this.linecap = "round", this.linejoin = "round", this.morphTargets = !1, this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.color.copy(source.color), this.linewidth = source.linewidth, this.linecap = source.linecap, this.linejoin = source.linejoin, this.morphTargets = source.morphTargets, this;
  }
};
LineBasicMaterial.prototype.isLineBasicMaterial = !0;
var _start$1 = /* @__PURE__ */ new Vector3(), _end$1 = /* @__PURE__ */ new Vector3(), _inverseMatrix$1 = /* @__PURE__ */ new Matrix4(), _ray$1 = /* @__PURE__ */ new Ray(), _sphere$1 = /* @__PURE__ */ new Sphere(), Line = class extends Object3D {
  constructor(geometry = new BufferGeometry(), material = new LineBasicMaterial()) {
    super();
    this.type = "Line", this.geometry = geometry, this.material = material, this.updateMorphTargets();
  }
  copy(source) {
    return super.copy(source), this.material = source.material, this.geometry = source.geometry, this;
  }
  computeLineDistances() {
    let geometry = this.geometry;
    if (geometry.isBufferGeometry)
      if (geometry.index === null) {
        let positionAttribute = geometry.attributes.position, lineDistances = [0];
        for (let i = 1, l = positionAttribute.count; i < l; i++)
          _start$1.fromBufferAttribute(positionAttribute, i - 1), _end$1.fromBufferAttribute(positionAttribute, i), lineDistances[i] = lineDistances[i - 1], lineDistances[i] += _start$1.distanceTo(_end$1);
        geometry.setAttribute("lineDistance", new Float32BufferAttribute(lineDistances, 1));
      } else
        console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");
    else
      geometry.isGeometry && console.error("THREE.Line.computeLineDistances() no longer supports THREE.Geometry. Use THREE.BufferGeometry instead.");
    return this;
  }
  raycast(raycaster, intersects2) {
    let geometry = this.geometry, matrixWorld = this.matrixWorld, threshold = raycaster.params.Line.threshold, drawRange = geometry.drawRange;
    if (geometry.boundingSphere === null && geometry.computeBoundingSphere(), _sphere$1.copy(geometry.boundingSphere), _sphere$1.applyMatrix4(matrixWorld), _sphere$1.radius += threshold, raycaster.ray.intersectsSphere(_sphere$1) === !1)
      return;
    _inverseMatrix$1.copy(matrixWorld).invert(), _ray$1.copy(raycaster.ray).applyMatrix4(_inverseMatrix$1);
    let localThreshold = threshold / ((this.scale.x + this.scale.y + this.scale.z) / 3), localThresholdSq = localThreshold * localThreshold, vStart = new Vector3(), vEnd = new Vector3(), interSegment = new Vector3(), interRay = new Vector3(), step = this.isLineSegments ? 2 : 1;
    if (geometry.isBufferGeometry) {
      let index = geometry.index, positionAttribute = geometry.attributes.position;
      if (index !== null) {
        let start = Math.max(0, drawRange.start), end = Math.min(index.count, drawRange.start + drawRange.count);
        for (let i = start, l = end - 1; i < l; i += step) {
          let a = index.getX(i), b = index.getX(i + 1);
          if (vStart.fromBufferAttribute(positionAttribute, a), vEnd.fromBufferAttribute(positionAttribute, b), _ray$1.distanceSqToSegment(vStart, vEnd, interRay, interSegment) > localThresholdSq)
            continue;
          interRay.applyMatrix4(this.matrixWorld);
          let distance = raycaster.ray.origin.distanceTo(interRay);
          distance < raycaster.near || distance > raycaster.far || intersects2.push({
            distance,
            point: interSegment.clone().applyMatrix4(this.matrixWorld),
            index: i,
            face: null,
            faceIndex: null,
            object: this
          });
        }
      } else {
        let start = Math.max(0, drawRange.start), end = Math.min(positionAttribute.count, drawRange.start + drawRange.count);
        for (let i = start, l = end - 1; i < l; i += step) {
          if (vStart.fromBufferAttribute(positionAttribute, i), vEnd.fromBufferAttribute(positionAttribute, i + 1), _ray$1.distanceSqToSegment(vStart, vEnd, interRay, interSegment) > localThresholdSq)
            continue;
          interRay.applyMatrix4(this.matrixWorld);
          let distance = raycaster.ray.origin.distanceTo(interRay);
          distance < raycaster.near || distance > raycaster.far || intersects2.push({
            distance,
            point: interSegment.clone().applyMatrix4(this.matrixWorld),
            index: i,
            face: null,
            faceIndex: null,
            object: this
          });
        }
      }
    } else
      geometry.isGeometry && console.error("THREE.Line.raycast() no longer supports THREE.Geometry. Use THREE.BufferGeometry instead.");
  }
  updateMorphTargets() {
    let geometry = this.geometry;
    if (geometry.isBufferGeometry) {
      let morphAttributes = geometry.morphAttributes, keys = Object.keys(morphAttributes);
      if (keys.length > 0) {
        let morphAttribute = morphAttributes[keys[0]];
        if (morphAttribute !== void 0) {
          this.morphTargetInfluences = [], this.morphTargetDictionary = {};
          for (let m = 0, ml = morphAttribute.length; m < ml; m++) {
            let name = morphAttribute[m].name || String(m);
            this.morphTargetInfluences.push(0), this.morphTargetDictionary[name] = m;
          }
        }
      }
    } else {
      let morphTargets = geometry.morphTargets;
      morphTargets !== void 0 && morphTargets.length > 0 && console.error("THREE.Line.updateMorphTargets() does not support THREE.Geometry. Use THREE.BufferGeometry instead.");
    }
  }
};
Line.prototype.isLine = !0;
var _start = /* @__PURE__ */ new Vector3(), _end = /* @__PURE__ */ new Vector3(), LineSegments = class extends Line {
  constructor(geometry, material) {
    super(geometry, material);
    this.type = "LineSegments";
  }
  computeLineDistances() {
    let geometry = this.geometry;
    if (geometry.isBufferGeometry)
      if (geometry.index === null) {
        let positionAttribute = geometry.attributes.position, lineDistances = [];
        for (let i = 0, l = positionAttribute.count; i < l; i += 2)
          _start.fromBufferAttribute(positionAttribute, i), _end.fromBufferAttribute(positionAttribute, i + 1), lineDistances[i] = i === 0 ? 0 : lineDistances[i - 1], lineDistances[i + 1] = lineDistances[i] + _start.distanceTo(_end);
        geometry.setAttribute("lineDistance", new Float32BufferAttribute(lineDistances, 1));
      } else
        console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");
    else
      geometry.isGeometry && console.error("THREE.LineSegments.computeLineDistances() no longer supports THREE.Geometry. Use THREE.BufferGeometry instead.");
    return this;
  }
};
LineSegments.prototype.isLineSegments = !0;
var LineLoop = class extends Line {
  constructor(geometry, material) {
    super(geometry, material);
    this.type = "LineLoop";
  }
};
LineLoop.prototype.isLineLoop = !0;
var PointsMaterial = class extends Material {
  constructor(parameters) {
    super();
    this.type = "PointsMaterial", this.color = new Color(16777215), this.map = null, this.alphaMap = null, this.size = 1, this.sizeAttenuation = !0, this.morphTargets = !1, this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.color.copy(source.color), this.map = source.map, this.alphaMap = source.alphaMap, this.size = source.size, this.sizeAttenuation = source.sizeAttenuation, this.morphTargets = source.morphTargets, this;
  }
};
PointsMaterial.prototype.isPointsMaterial = !0;
var _inverseMatrix = /* @__PURE__ */ new Matrix4(), _ray = /* @__PURE__ */ new Ray(), _sphere = /* @__PURE__ */ new Sphere(), _position$2 = /* @__PURE__ */ new Vector3(), Points = class extends Object3D {
  constructor(geometry = new BufferGeometry(), material = new PointsMaterial()) {
    super();
    this.type = "Points", this.geometry = geometry, this.material = material, this.updateMorphTargets();
  }
  copy(source) {
    return super.copy(source), this.material = source.material, this.geometry = source.geometry, this;
  }
  raycast(raycaster, intersects2) {
    let geometry = this.geometry, matrixWorld = this.matrixWorld, threshold = raycaster.params.Points.threshold, drawRange = geometry.drawRange;
    if (geometry.boundingSphere === null && geometry.computeBoundingSphere(), _sphere.copy(geometry.boundingSphere), _sphere.applyMatrix4(matrixWorld), _sphere.radius += threshold, raycaster.ray.intersectsSphere(_sphere) === !1)
      return;
    _inverseMatrix.copy(matrixWorld).invert(), _ray.copy(raycaster.ray).applyMatrix4(_inverseMatrix);
    let localThreshold = threshold / ((this.scale.x + this.scale.y + this.scale.z) / 3), localThresholdSq = localThreshold * localThreshold;
    if (geometry.isBufferGeometry) {
      let index = geometry.index, positionAttribute = geometry.attributes.position;
      if (index !== null) {
        let start = Math.max(0, drawRange.start), end = Math.min(index.count, drawRange.start + drawRange.count);
        for (let i = start, il = end; i < il; i++) {
          let a = index.getX(i);
          _position$2.fromBufferAttribute(positionAttribute, a), testPoint(_position$2, a, localThresholdSq, matrixWorld, raycaster, intersects2, this);
        }
      } else {
        let start = Math.max(0, drawRange.start), end = Math.min(positionAttribute.count, drawRange.start + drawRange.count);
        for (let i = start, l = end; i < l; i++)
          _position$2.fromBufferAttribute(positionAttribute, i), testPoint(_position$2, i, localThresholdSq, matrixWorld, raycaster, intersects2, this);
      }
    } else
      console.error("THREE.Points.raycast() no longer supports THREE.Geometry. Use THREE.BufferGeometry instead.");
  }
  updateMorphTargets() {
    let geometry = this.geometry;
    if (geometry.isBufferGeometry) {
      let morphAttributes = geometry.morphAttributes, keys = Object.keys(morphAttributes);
      if (keys.length > 0) {
        let morphAttribute = morphAttributes[keys[0]];
        if (morphAttribute !== void 0) {
          this.morphTargetInfluences = [], this.morphTargetDictionary = {};
          for (let m = 0, ml = morphAttribute.length; m < ml; m++) {
            let name = morphAttribute[m].name || String(m);
            this.morphTargetInfluences.push(0), this.morphTargetDictionary[name] = m;
          }
        }
      }
    } else {
      let morphTargets = geometry.morphTargets;
      morphTargets !== void 0 && morphTargets.length > 0 && console.error("THREE.Points.updateMorphTargets() does not support THREE.Geometry. Use THREE.BufferGeometry instead.");
    }
  }
};
Points.prototype.isPoints = !0;
function testPoint(point, index, localThresholdSq, matrixWorld, raycaster, intersects2, object) {
  let rayPointDistanceSq = _ray.distanceSqToPoint(point);
  if (rayPointDistanceSq < localThresholdSq) {
    let intersectPoint = new Vector3();
    _ray.closestPointToPoint(point, intersectPoint), intersectPoint.applyMatrix4(matrixWorld);
    let distance = raycaster.ray.origin.distanceTo(intersectPoint);
    if (distance < raycaster.near || distance > raycaster.far)
      return;
    intersects2.push({
      distance,
      distanceToRay: Math.sqrt(rayPointDistanceSq),
      point: intersectPoint,
      index,
      face: null,
      object
    });
  }
}
var VideoTexture = class extends Texture {
  constructor(video, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy) {
    super(video, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy);
    this.format = format !== void 0 ? format : RGBFormat, this.minFilter = minFilter !== void 0 ? minFilter : LinearFilter, this.magFilter = magFilter !== void 0 ? magFilter : LinearFilter, this.generateMipmaps = !1;
    let scope = this;
    function updateVideo() {
      scope.needsUpdate = !0, video.requestVideoFrameCallback(updateVideo);
    }
    "requestVideoFrameCallback" in video && video.requestVideoFrameCallback(updateVideo);
  }
  clone() {
    return new this.constructor(this.image).copy(this);
  }
  update() {
    let video = this.image;
    "requestVideoFrameCallback" in video === !1 && video.readyState >= video.HAVE_CURRENT_DATA && (this.needsUpdate = !0);
  }
};
VideoTexture.prototype.isVideoTexture = !0;
var CompressedTexture = class extends Texture {
  constructor(mipmaps, width, height, format, type, mapping, wrapS, wrapT, magFilter, minFilter, anisotropy, encoding) {
    super(null, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy, encoding);
    this.image = { width, height }, this.mipmaps = mipmaps, this.flipY = !1, this.generateMipmaps = !1;
  }
};
CompressedTexture.prototype.isCompressedTexture = !0;
var CanvasTexture = class extends Texture {
  constructor(canvas, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy) {
    super(canvas, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy);
    this.needsUpdate = !0;
  }
};
CanvasTexture.prototype.isCanvasTexture = !0;
var DepthTexture = class extends Texture {
  constructor(width, height, type, mapping, wrapS, wrapT, magFilter, minFilter, anisotropy, format) {
    if (format = format !== void 0 ? format : DepthFormat, format !== DepthFormat && format !== DepthStencilFormat)
      throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");
    type === void 0 && format === DepthFormat && (type = UnsignedShortType), type === void 0 && format === DepthStencilFormat && (type = UnsignedInt248Type), super(null, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy), this.image = { width, height }, this.magFilter = magFilter !== void 0 ? magFilter : NearestFilter, this.minFilter = minFilter !== void 0 ? minFilter : NearestFilter, this.flipY = !1, this.generateMipmaps = !1;
  }
};
DepthTexture.prototype.isDepthTexture = !0;
var _v0 = new Vector3(), _v1$1 = new Vector3(), _normal = new Vector3(), _triangle = new Triangle();
var Earcut = {
  triangulate: function(data, holeIndices, dim) {
    dim = dim || 2;
    let hasHoles = holeIndices && holeIndices.length, outerLen = hasHoles ? holeIndices[0] * dim : data.length, outerNode = linkedList(data, 0, outerLen, dim, !0), triangles = [];
    if (!outerNode || outerNode.next === outerNode.prev)
      return triangles;
    let minX, minY, maxX, maxY, x, y, invSize;
    if (hasHoles && (outerNode = eliminateHoles(data, holeIndices, outerNode, dim)), data.length > 80 * dim) {
      minX = maxX = data[0], minY = maxY = data[1];
      for (let i = dim; i < outerLen; i += dim)
        x = data[i], y = data[i + 1], x < minX && (minX = x), y < minY && (minY = y), x > maxX && (maxX = x), y > maxY && (maxY = y);
      invSize = Math.max(maxX - minX, maxY - minY), invSize = invSize !== 0 ? 1 / invSize : 0;
    }
    return earcutLinked(outerNode, triangles, dim, minX, minY, invSize), triangles;
  }
};
function linkedList(data, start, end, dim, clockwise) {
  let i, last;
  if (clockwise === signedArea(data, start, end, dim) > 0)
    for (i = start; i < end; i += dim)
      last = insertNode(i, data[i], data[i + 1], last);
  else
    for (i = end - dim; i >= start; i -= dim)
      last = insertNode(i, data[i], data[i + 1], last);
  return last && equals(last, last.next) && (removeNode(last), last = last.next), last;
}
function filterPoints(start, end) {
  if (!start)
    return start;
  end || (end = start);
  let p = start, again;
  do
    if (again = !1, !p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      if (removeNode(p), p = end = p.prev, p === p.next)
        break;
      again = !0;
    } else
      p = p.next;
  while (again || p !== end);
  return end;
}
function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
  if (!ear)
    return;
  !pass && invSize && indexCurve(ear, minX, minY, invSize);
  let stop = ear, prev, next;
  for (; ear.prev !== ear.next; ) {
    if (prev = ear.prev, next = ear.next, invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
      triangles.push(prev.i / dim), triangles.push(ear.i / dim), triangles.push(next.i / dim), removeNode(ear), ear = next.next, stop = next.next;
      continue;
    }
    if (ear = next, ear === stop) {
      pass ? pass === 1 ? (ear = cureLocalIntersections(filterPoints(ear), triangles, dim), earcutLinked(ear, triangles, dim, minX, minY, invSize, 2)) : pass === 2 && splitEarcut(ear, triangles, dim, minX, minY, invSize) : earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
      break;
    }
  }
}
function isEar(ear) {
  let a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0)
    return !1;
  let p = ear.next.next;
  for (; p !== ear.prev; ) {
    if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0)
      return !1;
    p = p.next;
  }
  return !0;
}
function isEarHashed(ear, minX, minY, invSize) {
  let a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0)
    return !1;
  let minTX = a.x < b.x ? a.x < c.x ? a.x : c.x : b.x < c.x ? b.x : c.x, minTY = a.y < b.y ? a.y < c.y ? a.y : c.y : b.y < c.y ? b.y : c.y, maxTX = a.x > b.x ? a.x > c.x ? a.x : c.x : b.x > c.x ? b.x : c.x, maxTY = a.y > b.y ? a.y > c.y ? a.y : c.y : b.y > c.y ? b.y : c.y, minZ = zOrder(minTX, minTY, minX, minY, invSize), maxZ = zOrder(maxTX, maxTY, minX, minY, invSize), p = ear.prevZ, n = ear.nextZ;
  for (; p && p.z >= minZ && n && n.z <= maxZ; ) {
    if (p !== ear.prev && p !== ear.next && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0 || (p = p.prevZ, n !== ear.prev && n !== ear.next && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) && area(n.prev, n, n.next) >= 0))
      return !1;
    n = n.nextZ;
  }
  for (; p && p.z >= minZ; ) {
    if (p !== ear.prev && p !== ear.next && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0)
      return !1;
    p = p.prevZ;
  }
  for (; n && n.z <= maxZ; ) {
    if (n !== ear.prev && n !== ear.next && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) && area(n.prev, n, n.next) >= 0)
      return !1;
    n = n.nextZ;
  }
  return !0;
}
function cureLocalIntersections(start, triangles, dim) {
  let p = start;
  do {
    let a = p.prev, b = p.next.next;
    !equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a) && (triangles.push(a.i / dim), triangles.push(p.i / dim), triangles.push(b.i / dim), removeNode(p), removeNode(p.next), p = start = b), p = p.next;
  } while (p !== start);
  return filterPoints(p);
}
function splitEarcut(start, triangles, dim, minX, minY, invSize) {
  let a = start;
  do {
    let b = a.next.next;
    for (; b !== a.prev; ) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c = splitPolygon(a, b);
        a = filterPoints(a, a.next), c = filterPoints(c, c.next), earcutLinked(a, triangles, dim, minX, minY, invSize), earcutLinked(c, triangles, dim, minX, minY, invSize);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}
function eliminateHoles(data, holeIndices, outerNode, dim) {
  let queue = [], i, len, start, end, list;
  for (i = 0, len = holeIndices.length; i < len; i++)
    start = holeIndices[i] * dim, end = i < len - 1 ? holeIndices[i + 1] * dim : data.length, list = linkedList(data, start, end, dim, !1), list === list.next && (list.steiner = !0), queue.push(getLeftmost(list));
  for (queue.sort(compareX), i = 0; i < queue.length; i++)
    eliminateHole(queue[i], outerNode), outerNode = filterPoints(outerNode, outerNode.next);
  return outerNode;
}
function compareX(a, b) {
  return a.x - b.x;
}
function eliminateHole(hole, outerNode) {
  if (outerNode = findHoleBridge(hole, outerNode), outerNode) {
    let b = splitPolygon(outerNode, hole);
    filterPoints(outerNode, outerNode.next), filterPoints(b, b.next);
  }
}
function findHoleBridge(hole, outerNode) {
  let p = outerNode, hx = hole.x, hy = hole.y, qx = -Infinity, m;
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      let x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        if (qx = x, x === hx) {
          if (hy === p.y)
            return p;
          if (hy === p.next.y)
            return p.next;
        }
        m = p.x < p.next.x ? p : p.next;
      }
    }
    p = p.next;
  } while (p !== outerNode);
  if (!m)
    return null;
  if (hx === qx)
    return m;
  let stop = m, mx = m.x, my = m.y, tanMin = Infinity, tan;
  p = m;
  do
    hx >= p.x && p.x >= mx && hx !== p.x && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y) && (tan = Math.abs(hy - p.y) / (hx - p.x), locallyInside(p, hole) && (tan < tanMin || tan === tanMin && (p.x > m.x || p.x === m.x && sectorContainsSector(m, p))) && (m = p, tanMin = tan)), p = p.next;
  while (p !== stop);
  return m;
}
function sectorContainsSector(m, p) {
  return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}
function indexCurve(start, minX, minY, invSize) {
  let p = start;
  do
    p.z === null && (p.z = zOrder(p.x, p.y, minX, minY, invSize)), p.prevZ = p.prev, p.nextZ = p.next, p = p.next;
  while (p !== start);
  p.prevZ.nextZ = null, p.prevZ = null, sortLinked(p);
}
function sortLinked(list) {
  let i, p, q, e, tail, numMerges, pSize, qSize, inSize = 1;
  do {
    for (p = list, list = null, tail = null, numMerges = 0; p; ) {
      for (numMerges++, q = p, pSize = 0, i = 0; i < inSize && (pSize++, q = q.nextZ, !!q); i++)
        ;
      for (qSize = inSize; pSize > 0 || qSize > 0 && q; )
        pSize !== 0 && (qSize === 0 || !q || p.z <= q.z) ? (e = p, p = p.nextZ, pSize--) : (e = q, q = q.nextZ, qSize--), tail ? tail.nextZ = e : list = e, e.prevZ = tail, tail = e;
      p = q;
    }
    tail.nextZ = null, inSize *= 2;
  } while (numMerges > 1);
  return list;
}
function zOrder(x, y, minX, minY, invSize) {
  return x = 32767 * (x - minX) * invSize, y = 32767 * (y - minY) * invSize, x = (x | x << 8) & 16711935, x = (x | x << 4) & 252645135, x = (x | x << 2) & 858993459, x = (x | x << 1) & 1431655765, y = (y | y << 8) & 16711935, y = (y | y << 4) & 252645135, y = (y | y << 2) & 858993459, y = (y | y << 1) & 1431655765, x | y << 1;
}
function getLeftmost(start) {
  let p = start, leftmost = start;
  do
    (p.x < leftmost.x || p.x === leftmost.x && p.y < leftmost.y) && (leftmost = p), p = p.next;
  while (p !== start);
  return leftmost;
}
function pointInTriangle(ax, ay, bx, by, cx, cy, px2, py2) {
  return (cx - px2) * (ay - py2) - (ax - px2) * (cy - py2) >= 0 && (ax - px2) * (by - py2) - (bx - px2) * (ay - py2) >= 0 && (bx - px2) * (cy - py2) - (cx - px2) * (by - py2) >= 0;
}
function isValidDiagonal(a, b) {
  return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) && (locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && (area(a.prev, a, b.prev) || area(a, b.prev, b)) || equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0);
}
function area(p, q, r) {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}
function equals(p1, p2) {
  return p1.x === p2.x && p1.y === p2.y;
}
function intersects(p1, q1, p2, q2) {
  let o1 = sign(area(p1, q1, p2)), o2 = sign(area(p1, q1, q2)), o3 = sign(area(p2, q2, p1)), o4 = sign(area(p2, q2, q1));
  return !!(o1 !== o2 && o3 !== o4 || o1 === 0 && onSegment(p1, p2, q1) || o2 === 0 && onSegment(p1, q2, q1) || o3 === 0 && onSegment(p2, p1, q2) || o4 === 0 && onSegment(p2, q1, q2));
}
function onSegment(p, q, r) {
  return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
}
function sign(num) {
  return num > 0 ? 1 : num < 0 ? -1 : 0;
}
function intersectsPolygon(a, b) {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b))
      return !0;
    p = p.next;
  } while (p !== a);
  return !1;
}
function locallyInside(a, b) {
  return area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}
function middleInside(a, b) {
  let p = a, inside = !1, px2 = (a.x + b.x) / 2, py2 = (a.y + b.y) / 2;
  do
    p.y > py2 != p.next.y > py2 && p.next.y !== p.y && px2 < (p.next.x - p.x) * (py2 - p.y) / (p.next.y - p.y) + p.x && (inside = !inside), p = p.next;
  while (p !== a);
  return inside;
}
function splitPolygon(a, b) {
  let a2 = new Node(a.i, a.x, a.y), b2 = new Node(b.i, b.x, b.y), an = a.next, bp = b.prev;
  return a.next = b, b.prev = a, a2.next = an, an.prev = a2, b2.next = a2, a2.prev = b2, bp.next = b2, b2.prev = bp, b2;
}
function insertNode(i, x, y, last) {
  let p = new Node(i, x, y);
  return last ? (p.next = last.next, p.prev = last, last.next.prev = p, last.next = p) : (p.prev = p, p.next = p), p;
}
function removeNode(p) {
  p.next.prev = p.prev, p.prev.next = p.next, p.prevZ && (p.prevZ.nextZ = p.nextZ), p.nextZ && (p.nextZ.prevZ = p.prevZ);
}
function Node(i, x, y) {
  this.i = i, this.x = x, this.y = y, this.prev = null, this.next = null, this.z = null, this.prevZ = null, this.nextZ = null, this.steiner = !1;
}
function signedArea(data, start, end, dim) {
  let sum = 0;
  for (let i = start, j = end - dim; i < end; i += dim)
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]), j = i;
  return sum;
}
var ShapeUtils = class {
  static area(contour) {
    let n = contour.length, a = 0;
    for (let p = n - 1, q = 0; q < n; p = q++)
      a += contour[p].x * contour[q].y - contour[q].x * contour[p].y;
    return a * 0.5;
  }
  static isClockWise(pts) {
    return ShapeUtils.area(pts) < 0;
  }
  static triangulateShape(contour, holes) {
    let vertices = [], holeIndices = [], faces = [];
    removeDupEndPts(contour), addContour(vertices, contour);
    let holeIndex = contour.length;
    holes.forEach(removeDupEndPts);
    for (let i = 0; i < holes.length; i++)
      holeIndices.push(holeIndex), holeIndex += holes[i].length, addContour(vertices, holes[i]);
    let triangles = Earcut.triangulate(vertices, holeIndices);
    for (let i = 0; i < triangles.length; i += 3)
      faces.push(triangles.slice(i, i + 3));
    return faces;
  }
};
function removeDupEndPts(points) {
  let l = points.length;
  l > 2 && points[l - 1].equals(points[0]) && points.pop();
}
function addContour(vertices, contour) {
  for (let i = 0; i < contour.length; i++)
    vertices.push(contour[i].x), vertices.push(contour[i].y);
}
var ExtrudeGeometry = class extends BufferGeometry {
  constructor(shapes, options) {
    super();
    this.type = "ExtrudeGeometry", this.parameters = {
      shapes,
      options
    }, shapes = Array.isArray(shapes) ? shapes : [shapes];
    let scope = this, verticesArray = [], uvArray = [];
    for (let i = 0, l = shapes.length; i < l; i++) {
      let shape = shapes[i];
      addShape(shape);
    }
    this.setAttribute("position", new Float32BufferAttribute(verticesArray, 3)), this.setAttribute("uv", new Float32BufferAttribute(uvArray, 2)), this.computeVertexNormals();
    function addShape(shape) {
      let placeholder = [], curveSegments = options.curveSegments !== void 0 ? options.curveSegments : 12, steps = options.steps !== void 0 ? options.steps : 1, depth = options.depth !== void 0 ? options.depth : 100, bevelEnabled = options.bevelEnabled !== void 0 ? options.bevelEnabled : !0, bevelThickness = options.bevelThickness !== void 0 ? options.bevelThickness : 6, bevelSize = options.bevelSize !== void 0 ? options.bevelSize : bevelThickness - 2, bevelOffset = options.bevelOffset !== void 0 ? options.bevelOffset : 0, bevelSegments = options.bevelSegments !== void 0 ? options.bevelSegments : 3, extrudePath = options.extrudePath, uvgen = options.UVGenerator !== void 0 ? options.UVGenerator : WorldUVGenerator;
      options.amount !== void 0 && (console.warn("THREE.ExtrudeBufferGeometry: amount has been renamed to depth."), depth = options.amount);
      let extrudePts, extrudeByPath = !1, splineTube, binormal, normal, position2;
      extrudePath && (extrudePts = extrudePath.getSpacedPoints(steps), extrudeByPath = !0, bevelEnabled = !1, splineTube = extrudePath.computeFrenetFrames(steps, !1), binormal = new Vector3(), normal = new Vector3(), position2 = new Vector3()), bevelEnabled || (bevelSegments = 0, bevelThickness = 0, bevelSize = 0, bevelOffset = 0);
      let shapePoints = shape.extractPoints(curveSegments), vertices = shapePoints.shape, holes = shapePoints.holes;
      if (!ShapeUtils.isClockWise(vertices)) {
        vertices = vertices.reverse();
        for (let h = 0, hl = holes.length; h < hl; h++) {
          let ahole = holes[h];
          ShapeUtils.isClockWise(ahole) && (holes[h] = ahole.reverse());
        }
      }
      let faces = ShapeUtils.triangulateShape(vertices, holes), contour = vertices;
      for (let h = 0, hl = holes.length; h < hl; h++) {
        let ahole = holes[h];
        vertices = vertices.concat(ahole);
      }
      function scalePt2(pt, vec, size) {
        return vec || console.error("THREE.ExtrudeGeometry: vec does not exist"), vec.clone().multiplyScalar(size).add(pt);
      }
      let vlen = vertices.length, flen = faces.length;
      function getBevelVec(inPt, inPrev, inNext) {
        let v_trans_x, v_trans_y, shrink_by, v_prev_x = inPt.x - inPrev.x, v_prev_y = inPt.y - inPrev.y, v_next_x = inNext.x - inPt.x, v_next_y = inNext.y - inPt.y, v_prev_lensq = v_prev_x * v_prev_x + v_prev_y * v_prev_y, collinear0 = v_prev_x * v_next_y - v_prev_y * v_next_x;
        if (Math.abs(collinear0) > Number.EPSILON) {
          let v_prev_len = Math.sqrt(v_prev_lensq), v_next_len = Math.sqrt(v_next_x * v_next_x + v_next_y * v_next_y), ptPrevShift_x = inPrev.x - v_prev_y / v_prev_len, ptPrevShift_y = inPrev.y + v_prev_x / v_prev_len, ptNextShift_x = inNext.x - v_next_y / v_next_len, ptNextShift_y = inNext.y + v_next_x / v_next_len, sf = ((ptNextShift_x - ptPrevShift_x) * v_next_y - (ptNextShift_y - ptPrevShift_y) * v_next_x) / (v_prev_x * v_next_y - v_prev_y * v_next_x);
          v_trans_x = ptPrevShift_x + v_prev_x * sf - inPt.x, v_trans_y = ptPrevShift_y + v_prev_y * sf - inPt.y;
          let v_trans_lensq = v_trans_x * v_trans_x + v_trans_y * v_trans_y;
          if (v_trans_lensq <= 2)
            return new Vector2(v_trans_x, v_trans_y);
          shrink_by = Math.sqrt(v_trans_lensq / 2);
        } else {
          let direction_eq = !1;
          v_prev_x > Number.EPSILON ? v_next_x > Number.EPSILON && (direction_eq = !0) : v_prev_x < -Number.EPSILON ? v_next_x < -Number.EPSILON && (direction_eq = !0) : Math.sign(v_prev_y) === Math.sign(v_next_y) && (direction_eq = !0), direction_eq ? (v_trans_x = -v_prev_y, v_trans_y = v_prev_x, shrink_by = Math.sqrt(v_prev_lensq)) : (v_trans_x = v_prev_x, v_trans_y = v_prev_y, shrink_by = Math.sqrt(v_prev_lensq / 2));
        }
        return new Vector2(v_trans_x / shrink_by, v_trans_y / shrink_by);
      }
      let contourMovements = [];
      for (let i = 0, il = contour.length, j = il - 1, k = i + 1; i < il; i++, j++, k++)
        j === il && (j = 0), k === il && (k = 0), contourMovements[i] = getBevelVec(contour[i], contour[j], contour[k]);
      let holesMovements = [], oneHoleMovements, verticesMovements = contourMovements.concat();
      for (let h = 0, hl = holes.length; h < hl; h++) {
        let ahole = holes[h];
        oneHoleMovements = [];
        for (let i = 0, il = ahole.length, j = il - 1, k = i + 1; i < il; i++, j++, k++)
          j === il && (j = 0), k === il && (k = 0), oneHoleMovements[i] = getBevelVec(ahole[i], ahole[j], ahole[k]);
        holesMovements.push(oneHoleMovements), verticesMovements = verticesMovements.concat(oneHoleMovements);
      }
      for (let b = 0; b < bevelSegments; b++) {
        let t = b / bevelSegments, z = bevelThickness * Math.cos(t * Math.PI / 2), bs2 = bevelSize * Math.sin(t * Math.PI / 2) + bevelOffset;
        for (let i = 0, il = contour.length; i < il; i++) {
          let vert = scalePt2(contour[i], contourMovements[i], bs2);
          v(vert.x, vert.y, -z);
        }
        for (let h = 0, hl = holes.length; h < hl; h++) {
          let ahole = holes[h];
          oneHoleMovements = holesMovements[h];
          for (let i = 0, il = ahole.length; i < il; i++) {
            let vert = scalePt2(ahole[i], oneHoleMovements[i], bs2);
            v(vert.x, vert.y, -z);
          }
        }
      }
      let bs = bevelSize + bevelOffset;
      for (let i = 0; i < vlen; i++) {
        let vert = bevelEnabled ? scalePt2(vertices[i], verticesMovements[i], bs) : vertices[i];
        extrudeByPath ? (normal.copy(splineTube.normals[0]).multiplyScalar(vert.x), binormal.copy(splineTube.binormals[0]).multiplyScalar(vert.y), position2.copy(extrudePts[0]).add(normal).add(binormal), v(position2.x, position2.y, position2.z)) : v(vert.x, vert.y, 0);
      }
      for (let s = 1; s <= steps; s++)
        for (let i = 0; i < vlen; i++) {
          let vert = bevelEnabled ? scalePt2(vertices[i], verticesMovements[i], bs) : vertices[i];
          extrudeByPath ? (normal.copy(splineTube.normals[s]).multiplyScalar(vert.x), binormal.copy(splineTube.binormals[s]).multiplyScalar(vert.y), position2.copy(extrudePts[s]).add(normal).add(binormal), v(position2.x, position2.y, position2.z)) : v(vert.x, vert.y, depth / steps * s);
        }
      for (let b = bevelSegments - 1; b >= 0; b--) {
        let t = b / bevelSegments, z = bevelThickness * Math.cos(t * Math.PI / 2), bs2 = bevelSize * Math.sin(t * Math.PI / 2) + bevelOffset;
        for (let i = 0, il = contour.length; i < il; i++) {
          let vert = scalePt2(contour[i], contourMovements[i], bs2);
          v(vert.x, vert.y, depth + z);
        }
        for (let h = 0, hl = holes.length; h < hl; h++) {
          let ahole = holes[h];
          oneHoleMovements = holesMovements[h];
          for (let i = 0, il = ahole.length; i < il; i++) {
            let vert = scalePt2(ahole[i], oneHoleMovements[i], bs2);
            extrudeByPath ? v(vert.x, vert.y + extrudePts[steps - 1].y, extrudePts[steps - 1].x + z) : v(vert.x, vert.y, depth + z);
          }
        }
      }
      buildLidFaces(), buildSideFaces();
      function buildLidFaces() {
        let start = verticesArray.length / 3;
        if (bevelEnabled) {
          let layer = 0, offset = vlen * layer;
          for (let i = 0; i < flen; i++) {
            let face = faces[i];
            f3(face[2] + offset, face[1] + offset, face[0] + offset);
          }
          layer = steps + bevelSegments * 2, offset = vlen * layer;
          for (let i = 0; i < flen; i++) {
            let face = faces[i];
            f3(face[0] + offset, face[1] + offset, face[2] + offset);
          }
        } else {
          for (let i = 0; i < flen; i++) {
            let face = faces[i];
            f3(face[2], face[1], face[0]);
          }
          for (let i = 0; i < flen; i++) {
            let face = faces[i];
            f3(face[0] + vlen * steps, face[1] + vlen * steps, face[2] + vlen * steps);
          }
        }
        scope.addGroup(start, verticesArray.length / 3 - start, 0);
      }
      function buildSideFaces() {
        let start = verticesArray.length / 3, layeroffset = 0;
        sidewalls(contour, layeroffset), layeroffset += contour.length;
        for (let h = 0, hl = holes.length; h < hl; h++) {
          let ahole = holes[h];
          sidewalls(ahole, layeroffset), layeroffset += ahole.length;
        }
        scope.addGroup(start, verticesArray.length / 3 - start, 1);
      }
      function sidewalls(contour2, layeroffset) {
        let i = contour2.length;
        for (; --i >= 0; ) {
          let j = i, k = i - 1;
          k < 0 && (k = contour2.length - 1);
          for (let s = 0, sl = steps + bevelSegments * 2; s < sl; s++) {
            let slen1 = vlen * s, slen2 = vlen * (s + 1), a = layeroffset + j + slen1, b = layeroffset + k + slen1, c = layeroffset + k + slen2, d = layeroffset + j + slen2;
            f4(a, b, c, d);
          }
        }
      }
      function v(x, y, z) {
        placeholder.push(x), placeholder.push(y), placeholder.push(z);
      }
      function f3(a, b, c) {
        addVertex(a), addVertex(b), addVertex(c);
        let nextIndex = verticesArray.length / 3, uvs = uvgen.generateTopUV(scope, verticesArray, nextIndex - 3, nextIndex - 2, nextIndex - 1);
        addUV(uvs[0]), addUV(uvs[1]), addUV(uvs[2]);
      }
      function f4(a, b, c, d) {
        addVertex(a), addVertex(b), addVertex(d), addVertex(b), addVertex(c), addVertex(d);
        let nextIndex = verticesArray.length / 3, uvs = uvgen.generateSideWallUV(scope, verticesArray, nextIndex - 6, nextIndex - 3, nextIndex - 2, nextIndex - 1);
        addUV(uvs[0]), addUV(uvs[1]), addUV(uvs[3]), addUV(uvs[1]), addUV(uvs[2]), addUV(uvs[3]);
      }
      function addVertex(index) {
        verticesArray.push(placeholder[index * 3 + 0]), verticesArray.push(placeholder[index * 3 + 1]), verticesArray.push(placeholder[index * 3 + 2]);
      }
      function addUV(vector2) {
        uvArray.push(vector2.x), uvArray.push(vector2.y);
      }
    }
  }
  toJSON() {
    let data = super.toJSON(), shapes = this.parameters.shapes, options = this.parameters.options;
    return toJSON$1(shapes, options, data);
  }
}, WorldUVGenerator = {
  generateTopUV: function(geometry, vertices, indexA, indexB, indexC) {
    let a_x = vertices[indexA * 3], a_y = vertices[indexA * 3 + 1], b_x = vertices[indexB * 3], b_y = vertices[indexB * 3 + 1], c_x = vertices[indexC * 3], c_y = vertices[indexC * 3 + 1];
    return [
      new Vector2(a_x, a_y),
      new Vector2(b_x, b_y),
      new Vector2(c_x, c_y)
    ];
  },
  generateSideWallUV: function(geometry, vertices, indexA, indexB, indexC, indexD) {
    let a_x = vertices[indexA * 3], a_y = vertices[indexA * 3 + 1], a_z = vertices[indexA * 3 + 2], b_x = vertices[indexB * 3], b_y = vertices[indexB * 3 + 1], b_z = vertices[indexB * 3 + 2], c_x = vertices[indexC * 3], c_y = vertices[indexC * 3 + 1], c_z = vertices[indexC * 3 + 2], d_x = vertices[indexD * 3], d_y = vertices[indexD * 3 + 1], d_z = vertices[indexD * 3 + 2];
    return Math.abs(a_y - b_y) < Math.abs(a_x - b_x) ? [
      new Vector2(a_x, 1 - a_z),
      new Vector2(b_x, 1 - b_z),
      new Vector2(c_x, 1 - c_z),
      new Vector2(d_x, 1 - d_z)
    ] : [
      new Vector2(a_y, 1 - a_z),
      new Vector2(b_y, 1 - b_z),
      new Vector2(c_y, 1 - c_z),
      new Vector2(d_y, 1 - d_z)
    ];
  }
};
function toJSON$1(shapes, options, data) {
  if (data.shapes = [], Array.isArray(shapes))
    for (let i = 0, l = shapes.length; i < l; i++) {
      let shape = shapes[i];
      data.shapes.push(shape.uuid);
    }
  else
    data.shapes.push(shapes.uuid);
  return options.extrudePath !== void 0 && (data.options.extrudePath = options.extrudePath.toJSON()), data;
}
var ShapeGeometry = class extends BufferGeometry {
  constructor(shapes, curveSegments = 12) {
    super();
    this.type = "ShapeGeometry", this.parameters = {
      shapes,
      curveSegments
    };
    let indices = [], vertices = [], normals = [], uvs = [], groupStart = 0, groupCount = 0;
    if (Array.isArray(shapes) === !1)
      addShape(shapes);
    else
      for (let i = 0; i < shapes.length; i++)
        addShape(shapes[i]), this.addGroup(groupStart, groupCount, i), groupStart += groupCount, groupCount = 0;
    this.setIndex(indices), this.setAttribute("position", new Float32BufferAttribute(vertices, 3)), this.setAttribute("normal", new Float32BufferAttribute(normals, 3)), this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    function addShape(shape) {
      let indexOffset = vertices.length / 3, points = shape.extractPoints(curveSegments), shapeVertices = points.shape, shapeHoles = points.holes;
      ShapeUtils.isClockWise(shapeVertices) === !1 && (shapeVertices = shapeVertices.reverse());
      for (let i = 0, l = shapeHoles.length; i < l; i++) {
        let shapeHole = shapeHoles[i];
        ShapeUtils.isClockWise(shapeHole) === !0 && (shapeHoles[i] = shapeHole.reverse());
      }
      let faces = ShapeUtils.triangulateShape(shapeVertices, shapeHoles);
      for (let i = 0, l = shapeHoles.length; i < l; i++) {
        let shapeHole = shapeHoles[i];
        shapeVertices = shapeVertices.concat(shapeHole);
      }
      for (let i = 0, l = shapeVertices.length; i < l; i++) {
        let vertex = shapeVertices[i];
        vertices.push(vertex.x, vertex.y, 0), normals.push(0, 0, 1), uvs.push(vertex.x, vertex.y);
      }
      for (let i = 0, l = faces.length; i < l; i++) {
        let face = faces[i], a = face[0] + indexOffset, b = face[1] + indexOffset, c = face[2] + indexOffset;
        indices.push(a, b, c), groupCount += 3;
      }
    }
  }
  toJSON() {
    let data = super.toJSON(), shapes = this.parameters.shapes;
    return toJSON(shapes, data);
  }
};
function toJSON(shapes, data) {
  if (data.shapes = [], Array.isArray(shapes))
    for (let i = 0, l = shapes.length; i < l; i++) {
      let shape = shapes[i];
      data.shapes.push(shape.uuid);
    }
  else
    data.shapes.push(shapes.uuid);
  return data;
}
var ShadowMaterial = class extends Material {
  constructor(parameters) {
    super();
    this.type = "ShadowMaterial", this.color = new Color(0), this.transparent = !0, this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.color.copy(source.color), this;
  }
};
ShadowMaterial.prototype.isShadowMaterial = !0;
var RawShaderMaterial = class extends ShaderMaterial {
  constructor(parameters) {
    super(parameters);
    this.type = "RawShaderMaterial";
  }
};
RawShaderMaterial.prototype.isRawShaderMaterial = !0;
var MeshStandardMaterial = class extends Material {
  constructor(parameters) {
    super();
    this.defines = { STANDARD: "" }, this.type = "MeshStandardMaterial", this.color = new Color(16777215), this.roughness = 1, this.metalness = 0, this.map = null, this.lightMap = null, this.lightMapIntensity = 1, this.aoMap = null, this.aoMapIntensity = 1, this.emissive = new Color(0), this.emissiveIntensity = 1, this.emissiveMap = null, this.bumpMap = null, this.bumpScale = 1, this.normalMap = null, this.normalMapType = TangentSpaceNormalMap, this.normalScale = new Vector2(1, 1), this.displacementMap = null, this.displacementScale = 1, this.displacementBias = 0, this.roughnessMap = null, this.metalnessMap = null, this.alphaMap = null, this.envMap = null, this.envMapIntensity = 1, this.refractionRatio = 0.98, this.wireframe = !1, this.wireframeLinewidth = 1, this.wireframeLinecap = "round", this.wireframeLinejoin = "round", this.morphTargets = !1, this.morphNormals = !1, this.flatShading = !1, this.vertexTangents = !1, this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.defines = { STANDARD: "" }, this.color.copy(source.color), this.roughness = source.roughness, this.metalness = source.metalness, this.map = source.map, this.lightMap = source.lightMap, this.lightMapIntensity = source.lightMapIntensity, this.aoMap = source.aoMap, this.aoMapIntensity = source.aoMapIntensity, this.emissive.copy(source.emissive), this.emissiveMap = source.emissiveMap, this.emissiveIntensity = source.emissiveIntensity, this.bumpMap = source.bumpMap, this.bumpScale = source.bumpScale, this.normalMap = source.normalMap, this.normalMapType = source.normalMapType, this.normalScale.copy(source.normalScale), this.displacementMap = source.displacementMap, this.displacementScale = source.displacementScale, this.displacementBias = source.displacementBias, this.roughnessMap = source.roughnessMap, this.metalnessMap = source.metalnessMap, this.alphaMap = source.alphaMap, this.envMap = source.envMap, this.envMapIntensity = source.envMapIntensity, this.refractionRatio = source.refractionRatio, this.wireframe = source.wireframe, this.wireframeLinewidth = source.wireframeLinewidth, this.wireframeLinecap = source.wireframeLinecap, this.wireframeLinejoin = source.wireframeLinejoin, this.morphTargets = source.morphTargets, this.morphNormals = source.morphNormals, this.flatShading = source.flatShading, this.vertexTangents = source.vertexTangents, this;
  }
};
MeshStandardMaterial.prototype.isMeshStandardMaterial = !0;
var MeshPhysicalMaterial = class extends MeshStandardMaterial {
  constructor(parameters) {
    super();
    this.defines = {
      STANDARD: "",
      PHYSICAL: ""
    }, this.type = "MeshPhysicalMaterial", this.clearcoat = 0, this.clearcoatMap = null, this.clearcoatRoughness = 0, this.clearcoatRoughnessMap = null, this.clearcoatNormalScale = new Vector2(1, 1), this.clearcoatNormalMap = null, this.reflectivity = 0.5, Object.defineProperty(this, "ior", {
      get: function() {
        return (1 + 0.4 * this.reflectivity) / (1 - 0.4 * this.reflectivity);
      },
      set: function(ior) {
        this.reflectivity = clamp(2.5 * (ior - 1) / (ior + 1), 0, 1);
      }
    }), this.sheen = null, this.transmission = 0, this.transmissionMap = null, this.thickness = 0.01, this.thicknessMap = null, this.attenuationDistance = 0, this.attenuationColor = new Color(1, 1, 1), this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.defines = {
      STANDARD: "",
      PHYSICAL: ""
    }, this.clearcoat = source.clearcoat, this.clearcoatMap = source.clearcoatMap, this.clearcoatRoughness = source.clearcoatRoughness, this.clearcoatRoughnessMap = source.clearcoatRoughnessMap, this.clearcoatNormalMap = source.clearcoatNormalMap, this.clearcoatNormalScale.copy(source.clearcoatNormalScale), this.reflectivity = source.reflectivity, source.sheen ? this.sheen = (this.sheen || new Color()).copy(source.sheen) : this.sheen = null, this.transmission = source.transmission, this.transmissionMap = source.transmissionMap, this.thickness = source.thickness, this.thicknessMap = source.thicknessMap, this.attenuationDistance = source.attenuationDistance, this.attenuationColor.copy(source.attenuationColor), this;
  }
};
MeshPhysicalMaterial.prototype.isMeshPhysicalMaterial = !0;
var MeshPhongMaterial = class extends Material {
  constructor(parameters) {
    super();
    this.type = "MeshPhongMaterial", this.color = new Color(16777215), this.specular = new Color(1118481), this.shininess = 30, this.map = null, this.lightMap = null, this.lightMapIntensity = 1, this.aoMap = null, this.aoMapIntensity = 1, this.emissive = new Color(0), this.emissiveIntensity = 1, this.emissiveMap = null, this.bumpMap = null, this.bumpScale = 1, this.normalMap = null, this.normalMapType = TangentSpaceNormalMap, this.normalScale = new Vector2(1, 1), this.displacementMap = null, this.displacementScale = 1, this.displacementBias = 0, this.specularMap = null, this.alphaMap = null, this.envMap = null, this.combine = MultiplyOperation, this.reflectivity = 1, this.refractionRatio = 0.98, this.wireframe = !1, this.wireframeLinewidth = 1, this.wireframeLinecap = "round", this.wireframeLinejoin = "round", this.morphTargets = !1, this.morphNormals = !1, this.flatShading = !1, this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.color.copy(source.color), this.specular.copy(source.specular), this.shininess = source.shininess, this.map = source.map, this.lightMap = source.lightMap, this.lightMapIntensity = source.lightMapIntensity, this.aoMap = source.aoMap, this.aoMapIntensity = source.aoMapIntensity, this.emissive.copy(source.emissive), this.emissiveMap = source.emissiveMap, this.emissiveIntensity = source.emissiveIntensity, this.bumpMap = source.bumpMap, this.bumpScale = source.bumpScale, this.normalMap = source.normalMap, this.normalMapType = source.normalMapType, this.normalScale.copy(source.normalScale), this.displacementMap = source.displacementMap, this.displacementScale = source.displacementScale, this.displacementBias = source.displacementBias, this.specularMap = source.specularMap, this.alphaMap = source.alphaMap, this.envMap = source.envMap, this.combine = source.combine, this.reflectivity = source.reflectivity, this.refractionRatio = source.refractionRatio, this.wireframe = source.wireframe, this.wireframeLinewidth = source.wireframeLinewidth, this.wireframeLinecap = source.wireframeLinecap, this.wireframeLinejoin = source.wireframeLinejoin, this.morphTargets = source.morphTargets, this.morphNormals = source.morphNormals, this.flatShading = source.flatShading, this;
  }
};
MeshPhongMaterial.prototype.isMeshPhongMaterial = !0;
var MeshToonMaterial = class extends Material {
  constructor(parameters) {
    super();
    this.defines = { TOON: "" }, this.type = "MeshToonMaterial", this.color = new Color(16777215), this.map = null, this.gradientMap = null, this.lightMap = null, this.lightMapIntensity = 1, this.aoMap = null, this.aoMapIntensity = 1, this.emissive = new Color(0), this.emissiveIntensity = 1, this.emissiveMap = null, this.bumpMap = null, this.bumpScale = 1, this.normalMap = null, this.normalMapType = TangentSpaceNormalMap, this.normalScale = new Vector2(1, 1), this.displacementMap = null, this.displacementScale = 1, this.displacementBias = 0, this.alphaMap = null, this.wireframe = !1, this.wireframeLinewidth = 1, this.wireframeLinecap = "round", this.wireframeLinejoin = "round", this.morphTargets = !1, this.morphNormals = !1, this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.color.copy(source.color), this.map = source.map, this.gradientMap = source.gradientMap, this.lightMap = source.lightMap, this.lightMapIntensity = source.lightMapIntensity, this.aoMap = source.aoMap, this.aoMapIntensity = source.aoMapIntensity, this.emissive.copy(source.emissive), this.emissiveMap = source.emissiveMap, this.emissiveIntensity = source.emissiveIntensity, this.bumpMap = source.bumpMap, this.bumpScale = source.bumpScale, this.normalMap = source.normalMap, this.normalMapType = source.normalMapType, this.normalScale.copy(source.normalScale), this.displacementMap = source.displacementMap, this.displacementScale = source.displacementScale, this.displacementBias = source.displacementBias, this.alphaMap = source.alphaMap, this.wireframe = source.wireframe, this.wireframeLinewidth = source.wireframeLinewidth, this.wireframeLinecap = source.wireframeLinecap, this.wireframeLinejoin = source.wireframeLinejoin, this.morphTargets = source.morphTargets, this.morphNormals = source.morphNormals, this;
  }
};
MeshToonMaterial.prototype.isMeshToonMaterial = !0;
var MeshNormalMaterial = class extends Material {
  constructor(parameters) {
    super();
    this.type = "MeshNormalMaterial", this.bumpMap = null, this.bumpScale = 1, this.normalMap = null, this.normalMapType = TangentSpaceNormalMap, this.normalScale = new Vector2(1, 1), this.displacementMap = null, this.displacementScale = 1, this.displacementBias = 0, this.wireframe = !1, this.wireframeLinewidth = 1, this.fog = !1, this.morphTargets = !1, this.morphNormals = !1, this.flatShading = !1, this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.bumpMap = source.bumpMap, this.bumpScale = source.bumpScale, this.normalMap = source.normalMap, this.normalMapType = source.normalMapType, this.normalScale.copy(source.normalScale), this.displacementMap = source.displacementMap, this.displacementScale = source.displacementScale, this.displacementBias = source.displacementBias, this.wireframe = source.wireframe, this.wireframeLinewidth = source.wireframeLinewidth, this.morphTargets = source.morphTargets, this.morphNormals = source.morphNormals, this.flatShading = source.flatShading, this;
  }
};
MeshNormalMaterial.prototype.isMeshNormalMaterial = !0;
var MeshLambertMaterial = class extends Material {
  constructor(parameters) {
    super();
    this.type = "MeshLambertMaterial", this.color = new Color(16777215), this.map = null, this.lightMap = null, this.lightMapIntensity = 1, this.aoMap = null, this.aoMapIntensity = 1, this.emissive = new Color(0), this.emissiveIntensity = 1, this.emissiveMap = null, this.specularMap = null, this.alphaMap = null, this.envMap = null, this.combine = MultiplyOperation, this.reflectivity = 1, this.refractionRatio = 0.98, this.wireframe = !1, this.wireframeLinewidth = 1, this.wireframeLinecap = "round", this.wireframeLinejoin = "round", this.morphTargets = !1, this.morphNormals = !1, this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.color.copy(source.color), this.map = source.map, this.lightMap = source.lightMap, this.lightMapIntensity = source.lightMapIntensity, this.aoMap = source.aoMap, this.aoMapIntensity = source.aoMapIntensity, this.emissive.copy(source.emissive), this.emissiveMap = source.emissiveMap, this.emissiveIntensity = source.emissiveIntensity, this.specularMap = source.specularMap, this.alphaMap = source.alphaMap, this.envMap = source.envMap, this.combine = source.combine, this.reflectivity = source.reflectivity, this.refractionRatio = source.refractionRatio, this.wireframe = source.wireframe, this.wireframeLinewidth = source.wireframeLinewidth, this.wireframeLinecap = source.wireframeLinecap, this.wireframeLinejoin = source.wireframeLinejoin, this.morphTargets = source.morphTargets, this.morphNormals = source.morphNormals, this;
  }
};
MeshLambertMaterial.prototype.isMeshLambertMaterial = !0;
var MeshMatcapMaterial = class extends Material {
  constructor(parameters) {
    super();
    this.defines = { MATCAP: "" }, this.type = "MeshMatcapMaterial", this.color = new Color(16777215), this.matcap = null, this.map = null, this.bumpMap = null, this.bumpScale = 1, this.normalMap = null, this.normalMapType = TangentSpaceNormalMap, this.normalScale = new Vector2(1, 1), this.displacementMap = null, this.displacementScale = 1, this.displacementBias = 0, this.alphaMap = null, this.morphTargets = !1, this.morphNormals = !1, this.flatShading = !1, this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.defines = { MATCAP: "" }, this.color.copy(source.color), this.matcap = source.matcap, this.map = source.map, this.bumpMap = source.bumpMap, this.bumpScale = source.bumpScale, this.normalMap = source.normalMap, this.normalMapType = source.normalMapType, this.normalScale.copy(source.normalScale), this.displacementMap = source.displacementMap, this.displacementScale = source.displacementScale, this.displacementBias = source.displacementBias, this.alphaMap = source.alphaMap, this.morphTargets = source.morphTargets, this.morphNormals = source.morphNormals, this.flatShading = source.flatShading, this;
  }
};
MeshMatcapMaterial.prototype.isMeshMatcapMaterial = !0;
var LineDashedMaterial = class extends LineBasicMaterial {
  constructor(parameters) {
    super();
    this.type = "LineDashedMaterial", this.scale = 1, this.dashSize = 3, this.gapSize = 1, this.setValues(parameters);
  }
  copy(source) {
    return super.copy(source), this.scale = source.scale, this.dashSize = source.dashSize, this.gapSize = source.gapSize, this;
  }
};
LineDashedMaterial.prototype.isLineDashedMaterial = !0;
var AnimationUtils = {
  arraySlice: function(array, from, to) {
    return AnimationUtils.isTypedArray(array) ? new array.constructor(array.subarray(from, to !== void 0 ? to : array.length)) : array.slice(from, to);
  },
  convertArray: function(array, type, forceClone) {
    return !array || !forceClone && array.constructor === type ? array : typeof type.BYTES_PER_ELEMENT == "number" ? new type(array) : Array.prototype.slice.call(array);
  },
  isTypedArray: function(object) {
    return ArrayBuffer.isView(object) && !(object instanceof DataView);
  },
  getKeyframeOrder: function(times) {
    function compareTime(i, j) {
      return times[i] - times[j];
    }
    let n = times.length, result = new Array(n);
    for (let i = 0; i !== n; ++i)
      result[i] = i;
    return result.sort(compareTime), result;
  },
  sortedArray: function(values, stride, order) {
    let nValues = values.length, result = new values.constructor(nValues);
    for (let i = 0, dstOffset = 0; dstOffset !== nValues; ++i) {
      let srcOffset = order[i] * stride;
      for (let j = 0; j !== stride; ++j)
        result[dstOffset++] = values[srcOffset + j];
    }
    return result;
  },
  flattenJSON: function(jsonKeys, times, values, valuePropertyName) {
    let i = 1, key = jsonKeys[0];
    for (; key !== void 0 && key[valuePropertyName] === void 0; )
      key = jsonKeys[i++];
    if (key === void 0)
      return;
    let value = key[valuePropertyName];
    if (value !== void 0)
      if (Array.isArray(value))
        do
          value = key[valuePropertyName], value !== void 0 && (times.push(key.time), values.push.apply(values, value)), key = jsonKeys[i++];
        while (key !== void 0);
      else if (value.toArray !== void 0)
        do
          value = key[valuePropertyName], value !== void 0 && (times.push(key.time), value.toArray(values, values.length)), key = jsonKeys[i++];
        while (key !== void 0);
      else
        do
          value = key[valuePropertyName], value !== void 0 && (times.push(key.time), values.push(value)), key = jsonKeys[i++];
        while (key !== void 0);
  },
  subclip: function(sourceClip, name, startFrame, endFrame, fps = 30) {
    let clip = sourceClip.clone();
    clip.name = name;
    let tracks = [];
    for (let i = 0; i < clip.tracks.length; ++i) {
      let track = clip.tracks[i], valueSize = track.getValueSize(), times = [], values = [];
      for (let j = 0; j < track.times.length; ++j) {
        let frame = track.times[j] * fps;
        if (!(frame < startFrame || frame >= endFrame)) {
          times.push(track.times[j]);
          for (let k = 0; k < valueSize; ++k)
            values.push(track.values[j * valueSize + k]);
        }
      }
      times.length !== 0 && (track.times = AnimationUtils.convertArray(times, track.times.constructor), track.values = AnimationUtils.convertArray(values, track.values.constructor), tracks.push(track));
    }
    clip.tracks = tracks;
    let minStartTime = Infinity;
    for (let i = 0; i < clip.tracks.length; ++i)
      minStartTime > clip.tracks[i].times[0] && (minStartTime = clip.tracks[i].times[0]);
    for (let i = 0; i < clip.tracks.length; ++i)
      clip.tracks[i].shift(-1 * minStartTime);
    return clip.resetDuration(), clip;
  },
  makeClipAdditive: function(targetClip, referenceFrame = 0, referenceClip = targetClip, fps = 30) {
    fps <= 0 && (fps = 30);
    let numTracks = referenceClip.tracks.length, referenceTime = referenceFrame / fps;
    for (let i = 0; i < numTracks; ++i) {
      let referenceTrack = referenceClip.tracks[i], referenceTrackType = referenceTrack.ValueTypeName;
      if (referenceTrackType === "bool" || referenceTrackType === "string")
        continue;
      let targetTrack = targetClip.tracks.find(function(track) {
        return track.name === referenceTrack.name && track.ValueTypeName === referenceTrackType;
      });
      if (targetTrack === void 0)
        continue;
      let referenceOffset = 0, referenceValueSize = referenceTrack.getValueSize();
      referenceTrack.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline && (referenceOffset = referenceValueSize / 3);
      let targetOffset = 0, targetValueSize = targetTrack.getValueSize();
      targetTrack.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline && (targetOffset = targetValueSize / 3);
      let lastIndex = referenceTrack.times.length - 1, referenceValue;
      if (referenceTime <= referenceTrack.times[0]) {
        let startIndex = referenceOffset, endIndex = referenceValueSize - referenceOffset;
        referenceValue = AnimationUtils.arraySlice(referenceTrack.values, startIndex, endIndex);
      } else if (referenceTime >= referenceTrack.times[lastIndex]) {
        let startIndex = lastIndex * referenceValueSize + referenceOffset, endIndex = startIndex + referenceValueSize - referenceOffset;
        referenceValue = AnimationUtils.arraySlice(referenceTrack.values, startIndex, endIndex);
      } else {
        let interpolant = referenceTrack.createInterpolant(), startIndex = referenceOffset, endIndex = referenceValueSize - referenceOffset;
        interpolant.evaluate(referenceTime), referenceValue = AnimationUtils.arraySlice(interpolant.resultBuffer, startIndex, endIndex);
      }
      referenceTrackType === "quaternion" && new Quaternion().fromArray(referenceValue).normalize().conjugate().toArray(referenceValue);
      let numTimes = targetTrack.times.length;
      for (let j = 0; j < numTimes; ++j) {
        let valueStart = j * targetValueSize + targetOffset;
        if (referenceTrackType === "quaternion")
          Quaternion.multiplyQuaternionsFlat(targetTrack.values, valueStart, referenceValue, 0, targetTrack.values, valueStart);
        else {
          let valueEnd = targetValueSize - targetOffset * 2;
          for (let k = 0; k < valueEnd; ++k)
            targetTrack.values[valueStart + k] -= referenceValue[k];
        }
      }
    }
    return targetClip.blendMode = AdditiveAnimationBlendMode, targetClip;
  }
}, Interpolant = class {
  constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
    this.parameterPositions = parameterPositions, this._cachedIndex = 0, this.resultBuffer = resultBuffer !== void 0 ? resultBuffer : new sampleValues.constructor(sampleSize), this.sampleValues = sampleValues, this.valueSize = sampleSize, this.settings = null, this.DefaultSettings_ = {};
  }
  evaluate(t) {
    let pp = this.parameterPositions, i1 = this._cachedIndex, t1 = pp[i1], t0 = pp[i1 - 1];
    validate_interval: {
      seek: {
        let right;
        linear_scan: {
          forward_scan:
            if (!(t < t1)) {
              for (let giveUpAt = i1 + 2; ; ) {
                if (t1 === void 0) {
                  if (t < t0)
                    break forward_scan;
                  return i1 = pp.length, this._cachedIndex = i1, this.afterEnd_(i1 - 1, t, t0);
                }
                if (i1 === giveUpAt)
                  break;
                if (t0 = t1, t1 = pp[++i1], t < t1)
                  break seek;
              }
              right = pp.length;
              break linear_scan;
            }
          if (!(t >= t0)) {
            let t1global = pp[1];
            t < t1global && (i1 = 2, t0 = t1global);
            for (let giveUpAt = i1 - 2; ; ) {
              if (t0 === void 0)
                return this._cachedIndex = 0, this.beforeStart_(0, t, t1);
              if (i1 === giveUpAt)
                break;
              if (t1 = t0, t0 = pp[--i1 - 1], t >= t0)
                break seek;
            }
            right = i1, i1 = 0;
            break linear_scan;
          }
          break validate_interval;
        }
        for (; i1 < right; ) {
          let mid = i1 + right >>> 1;
          t < pp[mid] ? right = mid : i1 = mid + 1;
        }
        if (t1 = pp[i1], t0 = pp[i1 - 1], t0 === void 0)
          return this._cachedIndex = 0, this.beforeStart_(0, t, t1);
        if (t1 === void 0)
          return i1 = pp.length, this._cachedIndex = i1, this.afterEnd_(i1 - 1, t0, t);
      }
      this._cachedIndex = i1, this.intervalChanged_(i1, t0, t1);
    }
    return this.interpolate_(i1, t0, t, t1);
  }
  getSettings_() {
    return this.settings || this.DefaultSettings_;
  }
  copySampleValue_(index) {
    let result = this.resultBuffer, values = this.sampleValues, stride = this.valueSize, offset = index * stride;
    for (let i = 0; i !== stride; ++i)
      result[i] = values[offset + i];
    return result;
  }
  interpolate_() {
    throw new Error("call to abstract method");
  }
  intervalChanged_() {
  }
};
Interpolant.prototype.beforeStart_ = Interpolant.prototype.copySampleValue_;
Interpolant.prototype.afterEnd_ = Interpolant.prototype.copySampleValue_;
var CubicInterpolant = class extends Interpolant {
  constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
    super(parameterPositions, sampleValues, sampleSize, resultBuffer);
    this._weightPrev = -0, this._offsetPrev = -0, this._weightNext = -0, this._offsetNext = -0, this.DefaultSettings_ = {
      endingStart: ZeroCurvatureEnding,
      endingEnd: ZeroCurvatureEnding
    };
  }
  intervalChanged_(i1, t0, t1) {
    let pp = this.parameterPositions, iPrev = i1 - 2, iNext = i1 + 1, tPrev = pp[iPrev], tNext = pp[iNext];
    if (tPrev === void 0)
      switch (this.getSettings_().endingStart) {
        case ZeroSlopeEnding:
          iPrev = i1, tPrev = 2 * t0 - t1;
          break;
        case WrapAroundEnding:
          iPrev = pp.length - 2, tPrev = t0 + pp[iPrev] - pp[iPrev + 1];
          break;
        default:
          iPrev = i1, tPrev = t1;
      }
    if (tNext === void 0)
      switch (this.getSettings_().endingEnd) {
        case ZeroSlopeEnding:
          iNext = i1, tNext = 2 * t1 - t0;
          break;
        case WrapAroundEnding:
          iNext = 1, tNext = t1 + pp[1] - pp[0];
          break;
        default:
          iNext = i1 - 1, tNext = t0;
      }
    let halfDt = (t1 - t0) * 0.5, stride = this.valueSize;
    this._weightPrev = halfDt / (t0 - tPrev), this._weightNext = halfDt / (tNext - t1), this._offsetPrev = iPrev * stride, this._offsetNext = iNext * stride;
  }
  interpolate_(i1, t0, t, t1) {
    let result = this.resultBuffer, values = this.sampleValues, stride = this.valueSize, o1 = i1 * stride, o0 = o1 - stride, oP = this._offsetPrev, oN = this._offsetNext, wP = this._weightPrev, wN = this._weightNext, p = (t - t0) / (t1 - t0), pp = p * p, ppp = pp * p, sP = -wP * ppp + 2 * wP * pp - wP * p, s0 = (1 + wP) * ppp + (-1.5 - 2 * wP) * pp + (-0.5 + wP) * p + 1, s1 = (-1 - wN) * ppp + (1.5 + wN) * pp + 0.5 * p, sN = wN * ppp - wN * pp;
    for (let i = 0; i !== stride; ++i)
      result[i] = sP * values[oP + i] + s0 * values[o0 + i] + s1 * values[o1 + i] + sN * values[oN + i];
    return result;
  }
}, LinearInterpolant = class extends Interpolant {
  constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
    super(parameterPositions, sampleValues, sampleSize, resultBuffer);
  }
  interpolate_(i1, t0, t, t1) {
    let result = this.resultBuffer, values = this.sampleValues, stride = this.valueSize, offset1 = i1 * stride, offset0 = offset1 - stride, weight1 = (t - t0) / (t1 - t0), weight0 = 1 - weight1;
    for (let i = 0; i !== stride; ++i)
      result[i] = values[offset0 + i] * weight0 + values[offset1 + i] * weight1;
    return result;
  }
}, DiscreteInterpolant = class extends Interpolant {
  constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
    super(parameterPositions, sampleValues, sampleSize, resultBuffer);
  }
  interpolate_(i1) {
    return this.copySampleValue_(i1 - 1);
  }
}, KeyframeTrack = class {
  constructor(name, times, values, interpolation) {
    if (name === void 0)
      throw new Error("THREE.KeyframeTrack: track name is undefined");
    if (times === void 0 || times.length === 0)
      throw new Error("THREE.KeyframeTrack: no keyframes in track named " + name);
    this.name = name, this.times = AnimationUtils.convertArray(times, this.TimeBufferType), this.values = AnimationUtils.convertArray(values, this.ValueBufferType), this.setInterpolation(interpolation || this.DefaultInterpolation);
  }
  static toJSON(track) {
    let trackType = track.constructor, json;
    if (trackType.toJSON !== this.toJSON)
      json = trackType.toJSON(track);
    else {
      json = {
        name: track.name,
        times: AnimationUtils.convertArray(track.times, Array),
        values: AnimationUtils.convertArray(track.values, Array)
      };
      let interpolation = track.getInterpolation();
      interpolation !== track.DefaultInterpolation && (json.interpolation = interpolation);
    }
    return json.type = track.ValueTypeName, json;
  }
  InterpolantFactoryMethodDiscrete(result) {
    return new DiscreteInterpolant(this.times, this.values, this.getValueSize(), result);
  }
  InterpolantFactoryMethodLinear(result) {
    return new LinearInterpolant(this.times, this.values, this.getValueSize(), result);
  }
  InterpolantFactoryMethodSmooth(result) {
    return new CubicInterpolant(this.times, this.values, this.getValueSize(), result);
  }
  setInterpolation(interpolation) {
    let factoryMethod;
    switch (interpolation) {
      case InterpolateDiscrete:
        factoryMethod = this.InterpolantFactoryMethodDiscrete;
        break;
      case InterpolateLinear:
        factoryMethod = this.InterpolantFactoryMethodLinear;
        break;
      case InterpolateSmooth:
        factoryMethod = this.InterpolantFactoryMethodSmooth;
        break;
    }
    if (factoryMethod === void 0) {
      let message = "unsupported interpolation for " + this.ValueTypeName + " keyframe track named " + this.name;
      if (this.createInterpolant === void 0)
        if (interpolation !== this.DefaultInterpolation)
          this.setInterpolation(this.DefaultInterpolation);
        else
          throw new Error(message);
      return console.warn("THREE.KeyframeTrack:", message), this;
    }
    return this.createInterpolant = factoryMethod, this;
  }
  getInterpolation() {
    switch (this.createInterpolant) {
      case this.InterpolantFactoryMethodDiscrete:
        return InterpolateDiscrete;
      case this.InterpolantFactoryMethodLinear:
        return InterpolateLinear;
      case this.InterpolantFactoryMethodSmooth:
        return InterpolateSmooth;
    }
  }
  getValueSize() {
    return this.values.length / this.times.length;
  }
  shift(timeOffset) {
    if (timeOffset !== 0) {
      let times = this.times;
      for (let i = 0, n = times.length; i !== n; ++i)
        times[i] += timeOffset;
    }
    return this;
  }
  scale(timeScale) {
    if (timeScale !== 1) {
      let times = this.times;
      for (let i = 0, n = times.length; i !== n; ++i)
        times[i] *= timeScale;
    }
    return this;
  }
  trim(startTime, endTime) {
    let times = this.times, nKeys = times.length, from = 0, to = nKeys - 1;
    for (; from !== nKeys && times[from] < startTime; )
      ++from;
    for (; to !== -1 && times[to] > endTime; )
      --to;
    if (++to, from !== 0 || to !== nKeys) {
      from >= to && (to = Math.max(to, 1), from = to - 1);
      let stride = this.getValueSize();
      this.times = AnimationUtils.arraySlice(times, from, to), this.values = AnimationUtils.arraySlice(this.values, from * stride, to * stride);
    }
    return this;
  }
  validate() {
    let valid = !0, valueSize = this.getValueSize();
    valueSize - Math.floor(valueSize) != 0 && (console.error("THREE.KeyframeTrack: Invalid value size in track.", this), valid = !1);
    let times = this.times, values = this.values, nKeys = times.length;
    nKeys === 0 && (console.error("THREE.KeyframeTrack: Track is empty.", this), valid = !1);
    let prevTime = null;
    for (let i = 0; i !== nKeys; i++) {
      let currTime = times[i];
      if (typeof currTime == "number" && isNaN(currTime)) {
        console.error("THREE.KeyframeTrack: Time is not a valid number.", this, i, currTime), valid = !1;
        break;
      }
      if (prevTime !== null && prevTime > currTime) {
        console.error("THREE.KeyframeTrack: Out of order keys.", this, i, currTime, prevTime), valid = !1;
        break;
      }
      prevTime = currTime;
    }
    if (values !== void 0 && AnimationUtils.isTypedArray(values))
      for (let i = 0, n = values.length; i !== n; ++i) {
        let value = values[i];
        if (isNaN(value)) {
          console.error("THREE.KeyframeTrack: Value is not a valid number.", this, i, value), valid = !1;
          break;
        }
      }
    return valid;
  }
  optimize() {
    let times = AnimationUtils.arraySlice(this.times), values = AnimationUtils.arraySlice(this.values), stride = this.getValueSize(), smoothInterpolation = this.getInterpolation() === InterpolateSmooth, lastIndex = times.length - 1, writeIndex = 1;
    for (let i = 1; i < lastIndex; ++i) {
      let keep = !1, time = times[i], timeNext = times[i + 1];
      if (time !== timeNext && (i !== 1 || time !== times[0]))
        if (smoothInterpolation)
          keep = !0;
        else {
          let offset = i * stride, offsetP = offset - stride, offsetN = offset + stride;
          for (let j = 0; j !== stride; ++j) {
            let value = values[offset + j];
            if (value !== values[offsetP + j] || value !== values[offsetN + j]) {
              keep = !0;
              break;
            }
          }
        }
      if (keep) {
        if (i !== writeIndex) {
          times[writeIndex] = times[i];
          let readOffset = i * stride, writeOffset = writeIndex * stride;
          for (let j = 0; j !== stride; ++j)
            values[writeOffset + j] = values[readOffset + j];
        }
        ++writeIndex;
      }
    }
    if (lastIndex > 0) {
      times[writeIndex] = times[lastIndex];
      for (let readOffset = lastIndex * stride, writeOffset = writeIndex * stride, j = 0; j !== stride; ++j)
        values[writeOffset + j] = values[readOffset + j];
      ++writeIndex;
    }
    return writeIndex !== times.length ? (this.times = AnimationUtils.arraySlice(times, 0, writeIndex), this.values = AnimationUtils.arraySlice(values, 0, writeIndex * stride)) : (this.times = times, this.values = values), this;
  }
  clone() {
    let times = AnimationUtils.arraySlice(this.times, 0), values = AnimationUtils.arraySlice(this.values, 0), TypedKeyframeTrack = this.constructor, track = new TypedKeyframeTrack(this.name, times, values);
    return track.createInterpolant = this.createInterpolant, track;
  }
};
KeyframeTrack.prototype.TimeBufferType = Float32Array;
KeyframeTrack.prototype.ValueBufferType = Float32Array;
KeyframeTrack.prototype.DefaultInterpolation = InterpolateLinear;
var BooleanKeyframeTrack = class extends KeyframeTrack {
};
BooleanKeyframeTrack.prototype.ValueTypeName = "bool";
BooleanKeyframeTrack.prototype.ValueBufferType = Array;
BooleanKeyframeTrack.prototype.DefaultInterpolation = InterpolateDiscrete;
BooleanKeyframeTrack.prototype.InterpolantFactoryMethodLinear = void 0;
BooleanKeyframeTrack.prototype.InterpolantFactoryMethodSmooth = void 0;
var ColorKeyframeTrack = class extends KeyframeTrack {
};
ColorKeyframeTrack.prototype.ValueTypeName = "color";
var NumberKeyframeTrack = class extends KeyframeTrack {
};
NumberKeyframeTrack.prototype.ValueTypeName = "number";
var QuaternionLinearInterpolant = class extends Interpolant {
  constructor(parameterPositions, sampleValues, sampleSize, resultBuffer) {
    super(parameterPositions, sampleValues, sampleSize, resultBuffer);
  }
  interpolate_(i1, t0, t, t1) {
    let result = this.resultBuffer, values = this.sampleValues, stride = this.valueSize, alpha = (t - t0) / (t1 - t0), offset = i1 * stride;
    for (let end = offset + stride; offset !== end; offset += 4)
      Quaternion.slerpFlat(result, 0, values, offset - stride, values, offset, alpha);
    return result;
  }
}, QuaternionKeyframeTrack = class extends KeyframeTrack {
  InterpolantFactoryMethodLinear(result) {
    return new QuaternionLinearInterpolant(this.times, this.values, this.getValueSize(), result);
  }
};
QuaternionKeyframeTrack.prototype.ValueTypeName = "quaternion";
QuaternionKeyframeTrack.prototype.DefaultInterpolation = InterpolateLinear;
QuaternionKeyframeTrack.prototype.InterpolantFactoryMethodSmooth = void 0;
var StringKeyframeTrack = class extends KeyframeTrack {
};
StringKeyframeTrack.prototype.ValueTypeName = "string";
StringKeyframeTrack.prototype.ValueBufferType = Array;
StringKeyframeTrack.prototype.DefaultInterpolation = InterpolateDiscrete;
StringKeyframeTrack.prototype.InterpolantFactoryMethodLinear = void 0;
StringKeyframeTrack.prototype.InterpolantFactoryMethodSmooth = void 0;
var VectorKeyframeTrack = class extends KeyframeTrack {
};
VectorKeyframeTrack.prototype.ValueTypeName = "vector";
var AnimationClip = class {
  constructor(name, duration = -1, tracks, blendMode = NormalAnimationBlendMode) {
    this.name = name, this.tracks = tracks, this.duration = duration, this.blendMode = blendMode, this.uuid = generateUUID(), this.duration < 0 && this.resetDuration();
  }
  static parse(json) {
    let tracks = [], jsonTracks = json.tracks, frameTime = 1 / (json.fps || 1);
    for (let i = 0, n = jsonTracks.length; i !== n; ++i)
      tracks.push(parseKeyframeTrack(jsonTracks[i]).scale(frameTime));
    let clip = new this(json.name, json.duration, tracks, json.blendMode);
    return clip.uuid = json.uuid, clip;
  }
  static toJSON(clip) {
    let tracks = [], clipTracks = clip.tracks, json = {
      name: clip.name,
      duration: clip.duration,
      tracks,
      uuid: clip.uuid,
      blendMode: clip.blendMode
    };
    for (let i = 0, n = clipTracks.length; i !== n; ++i)
      tracks.push(KeyframeTrack.toJSON(clipTracks[i]));
    return json;
  }
  static CreateFromMorphTargetSequence(name, morphTargetSequence, fps, noLoop) {
    let numMorphTargets = morphTargetSequence.length, tracks = [];
    for (let i = 0; i < numMorphTargets; i++) {
      let times = [], values = [];
      times.push((i + numMorphTargets - 1) % numMorphTargets, i, (i + 1) % numMorphTargets), values.push(0, 1, 0);
      let order = AnimationUtils.getKeyframeOrder(times);
      times = AnimationUtils.sortedArray(times, 1, order), values = AnimationUtils.sortedArray(values, 1, order), !noLoop && times[0] === 0 && (times.push(numMorphTargets), values.push(values[0])), tracks.push(new NumberKeyframeTrack(".morphTargetInfluences[" + morphTargetSequence[i].name + "]", times, values).scale(1 / fps));
    }
    return new this(name, -1, tracks);
  }
  static findByName(objectOrClipArray, name) {
    let clipArray = objectOrClipArray;
    if (!Array.isArray(objectOrClipArray)) {
      let o = objectOrClipArray;
      clipArray = o.geometry && o.geometry.animations || o.animations;
    }
    for (let i = 0; i < clipArray.length; i++)
      if (clipArray[i].name === name)
        return clipArray[i];
    return null;
  }
  static CreateClipsFromMorphTargetSequences(morphTargets, fps, noLoop) {
    let animationToMorphTargets = {}, pattern = /^([\w-]*?)([\d]+)$/;
    for (let i = 0, il = morphTargets.length; i < il; i++) {
      let morphTarget = morphTargets[i], parts = morphTarget.name.match(pattern);
      if (parts && parts.length > 1) {
        let name = parts[1], animationMorphTargets = animationToMorphTargets[name];
        animationMorphTargets || (animationToMorphTargets[name] = animationMorphTargets = []), animationMorphTargets.push(morphTarget);
      }
    }
    let clips = [];
    for (let name in animationToMorphTargets)
      clips.push(this.CreateFromMorphTargetSequence(name, animationToMorphTargets[name], fps, noLoop));
    return clips;
  }
  static parseAnimation(animation, bones) {
    if (!animation)
      return console.error("THREE.AnimationClip: No animation in JSONLoader data."), null;
    let addNonemptyTrack = function(trackType, trackName, animationKeys, propertyName, destTracks) {
      if (animationKeys.length !== 0) {
        let times = [], values = [];
        AnimationUtils.flattenJSON(animationKeys, times, values, propertyName), times.length !== 0 && destTracks.push(new trackType(trackName, times, values));
      }
    }, tracks = [], clipName = animation.name || "default", fps = animation.fps || 30, blendMode = animation.blendMode, duration = animation.length || -1, hierarchyTracks = animation.hierarchy || [];
    for (let h = 0; h < hierarchyTracks.length; h++) {
      let animationKeys = hierarchyTracks[h].keys;
      if (!(!animationKeys || animationKeys.length === 0))
        if (animationKeys[0].morphTargets) {
          let morphTargetNames = {}, k;
          for (k = 0; k < animationKeys.length; k++)
            if (animationKeys[k].morphTargets)
              for (let m = 0; m < animationKeys[k].morphTargets.length; m++)
                morphTargetNames[animationKeys[k].morphTargets[m]] = -1;
          for (let morphTargetName in morphTargetNames) {
            let times = [], values = [];
            for (let m = 0; m !== animationKeys[k].morphTargets.length; ++m) {
              let animationKey = animationKeys[k];
              times.push(animationKey.time), values.push(animationKey.morphTarget === morphTargetName ? 1 : 0);
            }
            tracks.push(new NumberKeyframeTrack(".morphTargetInfluence[" + morphTargetName + "]", times, values));
          }
          duration = morphTargetNames.length * (fps || 1);
        } else {
          let boneName = ".bones[" + bones[h].name + "]";
          addNonemptyTrack(VectorKeyframeTrack, boneName + ".position", animationKeys, "pos", tracks), addNonemptyTrack(QuaternionKeyframeTrack, boneName + ".quaternion", animationKeys, "rot", tracks), addNonemptyTrack(VectorKeyframeTrack, boneName + ".scale", animationKeys, "scl", tracks);
        }
    }
    return tracks.length === 0 ? null : new this(clipName, duration, tracks, blendMode);
  }
  resetDuration() {
    let tracks = this.tracks, duration = 0;
    for (let i = 0, n = tracks.length; i !== n; ++i) {
      let track = this.tracks[i];
      duration = Math.max(duration, track.times[track.times.length - 1]);
    }
    return this.duration = duration, this;
  }
  trim() {
    for (let i = 0; i < this.tracks.length; i++)
      this.tracks[i].trim(0, this.duration);
    return this;
  }
  validate() {
    let valid = !0;
    for (let i = 0; i < this.tracks.length; i++)
      valid = valid && this.tracks[i].validate();
    return valid;
  }
  optimize() {
    for (let i = 0; i < this.tracks.length; i++)
      this.tracks[i].optimize();
    return this;
  }
  clone() {
    let tracks = [];
    for (let i = 0; i < this.tracks.length; i++)
      tracks.push(this.tracks[i].clone());
    return new this.constructor(this.name, this.duration, tracks, this.blendMode);
  }
  toJSON() {
    return this.constructor.toJSON(this);
  }
};
function getTrackTypeForValueTypeName(typeName) {
  switch (typeName.toLowerCase()) {
    case "scalar":
    case "double":
    case "float":
    case "number":
    case "integer":
      return NumberKeyframeTrack;
    case "vector":
    case "vector2":
    case "vector3":
    case "vector4":
      return VectorKeyframeTrack;
    case "color":
      return ColorKeyframeTrack;
    case "quaternion":
      return QuaternionKeyframeTrack;
    case "bool":
    case "boolean":
      return BooleanKeyframeTrack;
    case "string":
      return StringKeyframeTrack;
  }
  throw new Error("THREE.KeyframeTrack: Unsupported typeName: " + typeName);
}
function parseKeyframeTrack(json) {
  if (json.type === void 0)
    throw new Error("THREE.KeyframeTrack: track type undefined, can not parse");
  let trackType = getTrackTypeForValueTypeName(json.type);
  if (json.times === void 0) {
    let times = [], values = [];
    AnimationUtils.flattenJSON(json.keys, times, values, "value"), json.times = times, json.values = values;
  }
  return trackType.parse !== void 0 ? trackType.parse(json) : new trackType(json.name, json.times, json.values, json.interpolation);
}
var Cache = {
  enabled: !1,
  files: {},
  add: function(key, file) {
    this.enabled !== !1 && (this.files[key] = file);
  },
  get: function(key) {
    if (this.enabled !== !1)
      return this.files[key];
  },
  remove: function(key) {
    delete this.files[key];
  },
  clear: function() {
    this.files = {};
  }
}, LoadingManager = class {
  constructor(onLoad, onProgress, onError) {
    let scope = this, isLoading = !1, itemsLoaded = 0, itemsTotal = 0, urlModifier, handlers = [];
    this.onStart = void 0, this.onLoad = onLoad, this.onProgress = onProgress, this.onError = onError, this.itemStart = function(url) {
      itemsTotal++, isLoading === !1 && scope.onStart !== void 0 && scope.onStart(url, itemsLoaded, itemsTotal), isLoading = !0;
    }, this.itemEnd = function(url) {
      itemsLoaded++, scope.onProgress !== void 0 && scope.onProgress(url, itemsLoaded, itemsTotal), itemsLoaded === itemsTotal && (isLoading = !1, scope.onLoad !== void 0 && scope.onLoad());
    }, this.itemError = function(url) {
      scope.onError !== void 0 && scope.onError(url);
    }, this.resolveURL = function(url) {
      return urlModifier ? urlModifier(url) : url;
    }, this.setURLModifier = function(transform) {
      return urlModifier = transform, this;
    }, this.addHandler = function(regex, loader) {
      return handlers.push(regex, loader), this;
    }, this.removeHandler = function(regex) {
      let index = handlers.indexOf(regex);
      return index !== -1 && handlers.splice(index, 2), this;
    }, this.getHandler = function(file) {
      for (let i = 0, l = handlers.length; i < l; i += 2) {
        let regex = handlers[i], loader = handlers[i + 1];
        if (regex.global && (regex.lastIndex = 0), regex.test(file))
          return loader;
      }
      return null;
    };
  }
}, DefaultLoadingManager = new LoadingManager(), Loader = class {
  constructor(manager) {
    this.manager = manager !== void 0 ? manager : DefaultLoadingManager, this.crossOrigin = "anonymous", this.withCredentials = !1, this.path = "", this.resourcePath = "", this.requestHeader = {};
  }
  load() {
  }
  loadAsync(url, onProgress) {
    let scope = this;
    return new Promise(function(resolve, reject) {
      scope.load(url, resolve, onProgress, reject);
    });
  }
  parse() {
  }
  setCrossOrigin(crossOrigin) {
    return this.crossOrigin = crossOrigin, this;
  }
  setWithCredentials(value) {
    return this.withCredentials = value, this;
  }
  setPath(path) {
    return this.path = path, this;
  }
  setResourcePath(resourcePath) {
    return this.resourcePath = resourcePath, this;
  }
  setRequestHeader(requestHeader) {
    return this.requestHeader = requestHeader, this;
  }
}, loading = {}, FileLoader = class extends Loader {
  constructor(manager) {
    super(manager);
  }
  load(url, onLoad, onProgress, onError) {
    url === void 0 && (url = ""), this.path !== void 0 && (url = this.path + url), url = this.manager.resolveURL(url);
    let scope = this, cached = Cache.get(url);
    if (cached !== void 0)
      return scope.manager.itemStart(url), setTimeout(function() {
        onLoad && onLoad(cached), scope.manager.itemEnd(url);
      }, 0), cached;
    if (loading[url] !== void 0) {
      loading[url].push({
        onLoad,
        onProgress,
        onError
      });
      return;
    }
    let dataUriRegex = /^data:(.*?)(;base64)?,(.*)$/, dataUriRegexResult = url.match(dataUriRegex), request;
    if (dataUriRegexResult) {
      let mimeType = dataUriRegexResult[1], isBase64 = !!dataUriRegexResult[2], data = dataUriRegexResult[3];
      data = decodeURIComponent(data), isBase64 && (data = atob(data));
      try {
        let response, responseType = (this.responseType || "").toLowerCase();
        switch (responseType) {
          case "arraybuffer":
          case "blob":
            let view = new Uint8Array(data.length);
            for (let i = 0; i < data.length; i++)
              view[i] = data.charCodeAt(i);
            responseType === "blob" ? response = new Blob([view.buffer], { type: mimeType }) : response = view.buffer;
            break;
          case "document":
            response = new DOMParser().parseFromString(data, mimeType);
            break;
          case "json":
            response = JSON.parse(data);
            break;
          default:
            response = data;
            break;
        }
        setTimeout(function() {
          onLoad && onLoad(response), scope.manager.itemEnd(url);
        }, 0);
      } catch (error) {
        setTimeout(function() {
          onError && onError(error), scope.manager.itemError(url), scope.manager.itemEnd(url);
        }, 0);
      }
    } else {
      loading[url] = [], loading[url].push({
        onLoad,
        onProgress,
        onError
      }), request = new XMLHttpRequest(), request.open("GET", url, !0), request.addEventListener("load", function(event) {
        let response = this.response, callbacks = loading[url];
        if (delete loading[url], this.status === 200 || this.status === 0) {
          this.status === 0 && console.warn("THREE.FileLoader: HTTP Status 0 received."), Cache.add(url, response);
          for (let i = 0, il = callbacks.length; i < il; i++) {
            let callback = callbacks[i];
            callback.onLoad && callback.onLoad(response);
          }
          scope.manager.itemEnd(url);
        } else {
          for (let i = 0, il = callbacks.length; i < il; i++) {
            let callback = callbacks[i];
            callback.onError && callback.onError(event);
          }
          scope.manager.itemError(url), scope.manager.itemEnd(url);
        }
      }, !1), request.addEventListener("progress", function(event) {
        let callbacks = loading[url];
        for (let i = 0, il = callbacks.length; i < il; i++) {
          let callback = callbacks[i];
          callback.onProgress && callback.onProgress(event);
        }
      }, !1), request.addEventListener("error", function(event) {
        let callbacks = loading[url];
        delete loading[url];
        for (let i = 0, il = callbacks.length; i < il; i++) {
          let callback = callbacks[i];
          callback.onError && callback.onError(event);
        }
        scope.manager.itemError(url), scope.manager.itemEnd(url);
      }, !1), request.addEventListener("abort", function(event) {
        let callbacks = loading[url];
        delete loading[url];
        for (let i = 0, il = callbacks.length; i < il; i++) {
          let callback = callbacks[i];
          callback.onError && callback.onError(event);
        }
        scope.manager.itemError(url), scope.manager.itemEnd(url);
      }, !1), this.responseType !== void 0 && (request.responseType = this.responseType), this.withCredentials !== void 0 && (request.withCredentials = this.withCredentials), request.overrideMimeType && request.overrideMimeType(this.mimeType !== void 0 ? this.mimeType : "text/plain");
      for (let header in this.requestHeader)
        request.setRequestHeader(header, this.requestHeader[header]);
      request.send(null);
    }
    return scope.manager.itemStart(url), request;
  }
  setResponseType(value) {
    return this.responseType = value, this;
  }
  setMimeType(value) {
    return this.mimeType = value, this;
  }
};
var ImageLoader = class extends Loader {
  constructor(manager) {
    super(manager);
  }
  load(url, onLoad, onProgress, onError) {
    this.path !== void 0 && (url = this.path + url), url = this.manager.resolveURL(url);
    let scope = this, cached = Cache.get(url);
    if (cached !== void 0)
      return scope.manager.itemStart(url), setTimeout(function() {
        onLoad && onLoad(cached), scope.manager.itemEnd(url);
      }, 0), cached;
    let image = document.createElementNS("http://www.w3.org/1999/xhtml", "img");
    function onImageLoad() {
      image.removeEventListener("load", onImageLoad, !1), image.removeEventListener("error", onImageError, !1), Cache.add(url, this), onLoad && onLoad(this), scope.manager.itemEnd(url);
    }
    function onImageError(event) {
      image.removeEventListener("load", onImageLoad, !1), image.removeEventListener("error", onImageError, !1), onError && onError(event), scope.manager.itemError(url), scope.manager.itemEnd(url);
    }
    return image.addEventListener("load", onImageLoad, !1), image.addEventListener("error", onImageError, !1), url.substr(0, 5) !== "data:" && this.crossOrigin !== void 0 && (image.crossOrigin = this.crossOrigin), scope.manager.itemStart(url), image.src = url, image;
  }
}, CubeTextureLoader = class extends Loader {
  constructor(manager) {
    super(manager);
  }
  load(urls, onLoad, onProgress, onError) {
    let texture = new CubeTexture(), loader = new ImageLoader(this.manager);
    loader.setCrossOrigin(this.crossOrigin), loader.setPath(this.path);
    let loaded = 0;
    function loadTexture(i) {
      loader.load(urls[i], function(image) {
        texture.images[i] = image, loaded++, loaded === 6 && (texture.needsUpdate = !0, onLoad && onLoad(texture));
      }, void 0, onError);
    }
    for (let i = 0; i < urls.length; ++i)
      loadTexture(i);
    return texture;
  }
};
var TextureLoader = class extends Loader {
  constructor(manager) {
    super(manager);
  }
  load(url, onLoad, onProgress, onError) {
    let texture = new Texture(), loader = new ImageLoader(this.manager);
    return loader.setCrossOrigin(this.crossOrigin), loader.setPath(this.path), loader.load(url, function(image) {
      texture.image = image;
      let isJPEG = url.search(/\.jpe?g($|\?)/i) > 0 || url.search(/^data\:image\/jpeg/) === 0;
      texture.format = isJPEG ? RGBFormat : RGBAFormat, texture.needsUpdate = !0, onLoad !== void 0 && onLoad(texture);
    }, onProgress, onError), texture;
  }
}, Curve = class {
  constructor() {
    this.type = "Curve", this.arcLengthDivisions = 200;
  }
  getPoint() {
    return console.warn("THREE.Curve: .getPoint() not implemented."), null;
  }
  getPointAt(u, optionalTarget) {
    let t = this.getUtoTmapping(u);
    return this.getPoint(t, optionalTarget);
  }
  getPoints(divisions = 5) {
    let points = [];
    for (let d = 0; d <= divisions; d++)
      points.push(this.getPoint(d / divisions));
    return points;
  }
  getSpacedPoints(divisions = 5) {
    let points = [];
    for (let d = 0; d <= divisions; d++)
      points.push(this.getPointAt(d / divisions));
    return points;
  }
  getLength() {
    let lengths = this.getLengths();
    return lengths[lengths.length - 1];
  }
  getLengths(divisions = this.arcLengthDivisions) {
    if (this.cacheArcLengths && this.cacheArcLengths.length === divisions + 1 && !this.needsUpdate)
      return this.cacheArcLengths;
    this.needsUpdate = !1;
    let cache = [], current, last = this.getPoint(0), sum = 0;
    cache.push(0);
    for (let p = 1; p <= divisions; p++)
      current = this.getPoint(p / divisions), sum += current.distanceTo(last), cache.push(sum), last = current;
    return this.cacheArcLengths = cache, cache;
  }
  updateArcLengths() {
    this.needsUpdate = !0, this.getLengths();
  }
  getUtoTmapping(u, distance) {
    let arcLengths = this.getLengths(), i = 0, il = arcLengths.length, targetArcLength;
    distance ? targetArcLength = distance : targetArcLength = u * arcLengths[il - 1];
    let low = 0, high = il - 1, comparison;
    for (; low <= high; )
      if (i = Math.floor(low + (high - low) / 2), comparison = arcLengths[i] - targetArcLength, comparison < 0)
        low = i + 1;
      else if (comparison > 0)
        high = i - 1;
      else {
        high = i;
        break;
      }
    if (i = high, arcLengths[i] === targetArcLength)
      return i / (il - 1);
    let lengthBefore = arcLengths[i], segmentLength = arcLengths[i + 1] - lengthBefore, segmentFraction = (targetArcLength - lengthBefore) / segmentLength;
    return (i + segmentFraction) / (il - 1);
  }
  getTangent(t, optionalTarget) {
    let delta = 1e-4, t1 = t - delta, t2 = t + delta;
    t1 < 0 && (t1 = 0), t2 > 1 && (t2 = 1);
    let pt1 = this.getPoint(t1), pt2 = this.getPoint(t2), tangent = optionalTarget || (pt1.isVector2 ? new Vector2() : new Vector3());
    return tangent.copy(pt2).sub(pt1).normalize(), tangent;
  }
  getTangentAt(u, optionalTarget) {
    let t = this.getUtoTmapping(u);
    return this.getTangent(t, optionalTarget);
  }
  computeFrenetFrames(segments, closed) {
    let normal = new Vector3(), tangents = [], normals = [], binormals = [], vec = new Vector3(), mat = new Matrix4();
    for (let i = 0; i <= segments; i++) {
      let u = i / segments;
      tangents[i] = this.getTangentAt(u, new Vector3()), tangents[i].normalize();
    }
    normals[0] = new Vector3(), binormals[0] = new Vector3();
    let min = Number.MAX_VALUE, tx = Math.abs(tangents[0].x), ty = Math.abs(tangents[0].y), tz = Math.abs(tangents[0].z);
    tx <= min && (min = tx, normal.set(1, 0, 0)), ty <= min && (min = ty, normal.set(0, 1, 0)), tz <= min && normal.set(0, 0, 1), vec.crossVectors(tangents[0], normal).normalize(), normals[0].crossVectors(tangents[0], vec), binormals[0].crossVectors(tangents[0], normals[0]);
    for (let i = 1; i <= segments; i++) {
      if (normals[i] = normals[i - 1].clone(), binormals[i] = binormals[i - 1].clone(), vec.crossVectors(tangents[i - 1], tangents[i]), vec.length() > Number.EPSILON) {
        vec.normalize();
        let theta = Math.acos(clamp(tangents[i - 1].dot(tangents[i]), -1, 1));
        normals[i].applyMatrix4(mat.makeRotationAxis(vec, theta));
      }
      binormals[i].crossVectors(tangents[i], normals[i]);
    }
    if (closed === !0) {
      let theta = Math.acos(clamp(normals[0].dot(normals[segments]), -1, 1));
      theta /= segments, tangents[0].dot(vec.crossVectors(normals[0], normals[segments])) > 0 && (theta = -theta);
      for (let i = 1; i <= segments; i++)
        normals[i].applyMatrix4(mat.makeRotationAxis(tangents[i], theta * i)), binormals[i].crossVectors(tangents[i], normals[i]);
    }
    return {
      tangents,
      normals,
      binormals
    };
  }
  clone() {
    return new this.constructor().copy(this);
  }
  copy(source) {
    return this.arcLengthDivisions = source.arcLengthDivisions, this;
  }
  toJSON() {
    let data = {
      metadata: {
        version: 4.5,
        type: "Curve",
        generator: "Curve.toJSON"
      }
    };
    return data.arcLengthDivisions = this.arcLengthDivisions, data.type = this.type, data;
  }
  fromJSON(json) {
    return this.arcLengthDivisions = json.arcLengthDivisions, this;
  }
}, EllipseCurve = class extends Curve {
  constructor(aX = 0, aY = 0, xRadius = 1, yRadius = 1, aStartAngle = 0, aEndAngle = Math.PI * 2, aClockwise = !1, aRotation = 0) {
    super();
    this.type = "EllipseCurve", this.aX = aX, this.aY = aY, this.xRadius = xRadius, this.yRadius = yRadius, this.aStartAngle = aStartAngle, this.aEndAngle = aEndAngle, this.aClockwise = aClockwise, this.aRotation = aRotation;
  }
  getPoint(t, optionalTarget) {
    let point = optionalTarget || new Vector2(), twoPi = Math.PI * 2, deltaAngle = this.aEndAngle - this.aStartAngle, samePoints = Math.abs(deltaAngle) < Number.EPSILON;
    for (; deltaAngle < 0; )
      deltaAngle += twoPi;
    for (; deltaAngle > twoPi; )
      deltaAngle -= twoPi;
    deltaAngle < Number.EPSILON && (samePoints ? deltaAngle = 0 : deltaAngle = twoPi), this.aClockwise === !0 && !samePoints && (deltaAngle === twoPi ? deltaAngle = -twoPi : deltaAngle = deltaAngle - twoPi);
    let angle = this.aStartAngle + t * deltaAngle, x = this.aX + this.xRadius * Math.cos(angle), y = this.aY + this.yRadius * Math.sin(angle);
    if (this.aRotation !== 0) {
      let cos = Math.cos(this.aRotation), sin = Math.sin(this.aRotation), tx = x - this.aX, ty = y - this.aY;
      x = tx * cos - ty * sin + this.aX, y = tx * sin + ty * cos + this.aY;
    }
    return point.set(x, y);
  }
  copy(source) {
    return super.copy(source), this.aX = source.aX, this.aY = source.aY, this.xRadius = source.xRadius, this.yRadius = source.yRadius, this.aStartAngle = source.aStartAngle, this.aEndAngle = source.aEndAngle, this.aClockwise = source.aClockwise, this.aRotation = source.aRotation, this;
  }
  toJSON() {
    let data = super.toJSON();
    return data.aX = this.aX, data.aY = this.aY, data.xRadius = this.xRadius, data.yRadius = this.yRadius, data.aStartAngle = this.aStartAngle, data.aEndAngle = this.aEndAngle, data.aClockwise = this.aClockwise, data.aRotation = this.aRotation, data;
  }
  fromJSON(json) {
    return super.fromJSON(json), this.aX = json.aX, this.aY = json.aY, this.xRadius = json.xRadius, this.yRadius = json.yRadius, this.aStartAngle = json.aStartAngle, this.aEndAngle = json.aEndAngle, this.aClockwise = json.aClockwise, this.aRotation = json.aRotation, this;
  }
};
EllipseCurve.prototype.isEllipseCurve = !0;
var ArcCurve = class extends EllipseCurve {
  constructor(aX, aY, aRadius, aStartAngle, aEndAngle, aClockwise) {
    super(aX, aY, aRadius, aRadius, aStartAngle, aEndAngle, aClockwise);
    this.type = "ArcCurve";
  }
};
ArcCurve.prototype.isArcCurve = !0;
function CubicPoly() {
  let c0 = 0, c1 = 0, c2 = 0, c3 = 0;
  function init(x0, x1, t0, t1) {
    c0 = x0, c1 = t0, c2 = -3 * x0 + 3 * x1 - 2 * t0 - t1, c3 = 2 * x0 - 2 * x1 + t0 + t1;
  }
  return {
    initCatmullRom: function(x0, x1, x2, x3, tension) {
      init(x1, x2, tension * (x2 - x0), tension * (x3 - x1));
    },
    initNonuniformCatmullRom: function(x0, x1, x2, x3, dt0, dt1, dt2) {
      let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1, t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
      t1 *= dt1, t2 *= dt1, init(x1, x2, t1, t2);
    },
    calc: function(t) {
      let t2 = t * t, t3 = t2 * t;
      return c0 + c1 * t + c2 * t2 + c3 * t3;
    }
  };
}
var tmp = new Vector3(), px = new CubicPoly(), py = new CubicPoly(), pz = new CubicPoly(), CatmullRomCurve3 = class extends Curve {
  constructor(points = [], closed = !1, curveType = "centripetal", tension = 0.5) {
    super();
    this.type = "CatmullRomCurve3", this.points = points, this.closed = closed, this.curveType = curveType, this.tension = tension;
  }
  getPoint(t, optionalTarget = new Vector3()) {
    let point = optionalTarget, points = this.points, l = points.length, p = (l - (this.closed ? 0 : 1)) * t, intPoint = Math.floor(p), weight = p - intPoint;
    this.closed ? intPoint += intPoint > 0 ? 0 : (Math.floor(Math.abs(intPoint) / l) + 1) * l : weight === 0 && intPoint === l - 1 && (intPoint = l - 2, weight = 1);
    let p0, p3;
    this.closed || intPoint > 0 ? p0 = points[(intPoint - 1) % l] : (tmp.subVectors(points[0], points[1]).add(points[0]), p0 = tmp);
    let p1 = points[intPoint % l], p2 = points[(intPoint + 1) % l];
    if (this.closed || intPoint + 2 < l ? p3 = points[(intPoint + 2) % l] : (tmp.subVectors(points[l - 1], points[l - 2]).add(points[l - 1]), p3 = tmp), this.curveType === "centripetal" || this.curveType === "chordal") {
      let pow = this.curveType === "chordal" ? 0.5 : 0.25, dt0 = Math.pow(p0.distanceToSquared(p1), pow), dt1 = Math.pow(p1.distanceToSquared(p2), pow), dt2 = Math.pow(p2.distanceToSquared(p3), pow);
      dt1 < 1e-4 && (dt1 = 1), dt0 < 1e-4 && (dt0 = dt1), dt2 < 1e-4 && (dt2 = dt1), px.initNonuniformCatmullRom(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2), py.initNonuniformCatmullRom(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2), pz.initNonuniformCatmullRom(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2);
    } else
      this.curveType === "catmullrom" && (px.initCatmullRom(p0.x, p1.x, p2.x, p3.x, this.tension), py.initCatmullRom(p0.y, p1.y, p2.y, p3.y, this.tension), pz.initCatmullRom(p0.z, p1.z, p2.z, p3.z, this.tension));
    return point.set(px.calc(weight), py.calc(weight), pz.calc(weight)), point;
  }
  copy(source) {
    super.copy(source), this.points = [];
    for (let i = 0, l = source.points.length; i < l; i++) {
      let point = source.points[i];
      this.points.push(point.clone());
    }
    return this.closed = source.closed, this.curveType = source.curveType, this.tension = source.tension, this;
  }
  toJSON() {
    let data = super.toJSON();
    data.points = [];
    for (let i = 0, l = this.points.length; i < l; i++) {
      let point = this.points[i];
      data.points.push(point.toArray());
    }
    return data.closed = this.closed, data.curveType = this.curveType, data.tension = this.tension, data;
  }
  fromJSON(json) {
    super.fromJSON(json), this.points = [];
    for (let i = 0, l = json.points.length; i < l; i++) {
      let point = json.points[i];
      this.points.push(new Vector3().fromArray(point));
    }
    return this.closed = json.closed, this.curveType = json.curveType, this.tension = json.tension, this;
  }
};
CatmullRomCurve3.prototype.isCatmullRomCurve3 = !0;
function CatmullRom(t, p0, p1, p2, p3) {
  let v0 = (p2 - p0) * 0.5, v1 = (p3 - p1) * 0.5, t2 = t * t, t3 = t * t2;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}
function QuadraticBezierP0(t, p) {
  let k = 1 - t;
  return k * k * p;
}
function QuadraticBezierP1(t, p) {
  return 2 * (1 - t) * t * p;
}
function QuadraticBezierP2(t, p) {
  return t * t * p;
}
function QuadraticBezier(t, p0, p1, p2) {
  return QuadraticBezierP0(t, p0) + QuadraticBezierP1(t, p1) + QuadraticBezierP2(t, p2);
}
function CubicBezierP0(t, p) {
  let k = 1 - t;
  return k * k * k * p;
}
function CubicBezierP1(t, p) {
  let k = 1 - t;
  return 3 * k * k * t * p;
}
function CubicBezierP2(t, p) {
  return 3 * (1 - t) * t * t * p;
}
function CubicBezierP3(t, p) {
  return t * t * t * p;
}
function CubicBezier(t, p0, p1, p2, p3) {
  return CubicBezierP0(t, p0) + CubicBezierP1(t, p1) + CubicBezierP2(t, p2) + CubicBezierP3(t, p3);
}
var CubicBezierCurve = class extends Curve {
  constructor(v0 = new Vector2(), v1 = new Vector2(), v2 = new Vector2(), v3 = new Vector2()) {
    super();
    this.type = "CubicBezierCurve", this.v0 = v0, this.v1 = v1, this.v2 = v2, this.v3 = v3;
  }
  getPoint(t, optionalTarget = new Vector2()) {
    let point = optionalTarget, v0 = this.v0, v1 = this.v1, v2 = this.v2, v3 = this.v3;
    return point.set(CubicBezier(t, v0.x, v1.x, v2.x, v3.x), CubicBezier(t, v0.y, v1.y, v2.y, v3.y)), point;
  }
  copy(source) {
    return super.copy(source), this.v0.copy(source.v0), this.v1.copy(source.v1), this.v2.copy(source.v2), this.v3.copy(source.v3), this;
  }
  toJSON() {
    let data = super.toJSON();
    return data.v0 = this.v0.toArray(), data.v1 = this.v1.toArray(), data.v2 = this.v2.toArray(), data.v3 = this.v3.toArray(), data;
  }
  fromJSON(json) {
    return super.fromJSON(json), this.v0.fromArray(json.v0), this.v1.fromArray(json.v1), this.v2.fromArray(json.v2), this.v3.fromArray(json.v3), this;
  }
};
CubicBezierCurve.prototype.isCubicBezierCurve = !0;
var CubicBezierCurve3 = class extends Curve {
  constructor(v0 = new Vector3(), v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3()) {
    super();
    this.type = "CubicBezierCurve3", this.v0 = v0, this.v1 = v1, this.v2 = v2, this.v3 = v3;
  }
  getPoint(t, optionalTarget = new Vector3()) {
    let point = optionalTarget, v0 = this.v0, v1 = this.v1, v2 = this.v2, v3 = this.v3;
    return point.set(CubicBezier(t, v0.x, v1.x, v2.x, v3.x), CubicBezier(t, v0.y, v1.y, v2.y, v3.y), CubicBezier(t, v0.z, v1.z, v2.z, v3.z)), point;
  }
  copy(source) {
    return super.copy(source), this.v0.copy(source.v0), this.v1.copy(source.v1), this.v2.copy(source.v2), this.v3.copy(source.v3), this;
  }
  toJSON() {
    let data = super.toJSON();
    return data.v0 = this.v0.toArray(), data.v1 = this.v1.toArray(), data.v2 = this.v2.toArray(), data.v3 = this.v3.toArray(), data;
  }
  fromJSON(json) {
    return super.fromJSON(json), this.v0.fromArray(json.v0), this.v1.fromArray(json.v1), this.v2.fromArray(json.v2), this.v3.fromArray(json.v3), this;
  }
};
CubicBezierCurve3.prototype.isCubicBezierCurve3 = !0;
var LineCurve = class extends Curve {
  constructor(v1 = new Vector2(), v2 = new Vector2()) {
    super();
    this.type = "LineCurve", this.v1 = v1, this.v2 = v2;
  }
  getPoint(t, optionalTarget = new Vector2()) {
    let point = optionalTarget;
    return t === 1 ? point.copy(this.v2) : (point.copy(this.v2).sub(this.v1), point.multiplyScalar(t).add(this.v1)), point;
  }
  getPointAt(u, optionalTarget) {
    return this.getPoint(u, optionalTarget);
  }
  getTangent(t, optionalTarget) {
    let tangent = optionalTarget || new Vector2();
    return tangent.copy(this.v2).sub(this.v1).normalize(), tangent;
  }
  copy(source) {
    return super.copy(source), this.v1.copy(source.v1), this.v2.copy(source.v2), this;
  }
  toJSON() {
    let data = super.toJSON();
    return data.v1 = this.v1.toArray(), data.v2 = this.v2.toArray(), data;
  }
  fromJSON(json) {
    return super.fromJSON(json), this.v1.fromArray(json.v1), this.v2.fromArray(json.v2), this;
  }
};
LineCurve.prototype.isLineCurve = !0;
var LineCurve3 = class extends Curve {
  constructor(v1 = new Vector3(), v2 = new Vector3()) {
    super();
    this.type = "LineCurve3", this.isLineCurve3 = !0, this.v1 = v1, this.v2 = v2;
  }
  getPoint(t, optionalTarget = new Vector3()) {
    let point = optionalTarget;
    return t === 1 ? point.copy(this.v2) : (point.copy(this.v2).sub(this.v1), point.multiplyScalar(t).add(this.v1)), point;
  }
  getPointAt(u, optionalTarget) {
    return this.getPoint(u, optionalTarget);
  }
  copy(source) {
    return super.copy(source), this.v1.copy(source.v1), this.v2.copy(source.v2), this;
  }
  toJSON() {
    let data = super.toJSON();
    return data.v1 = this.v1.toArray(), data.v2 = this.v2.toArray(), data;
  }
  fromJSON(json) {
    return super.fromJSON(json), this.v1.fromArray(json.v1), this.v2.fromArray(json.v2), this;
  }
}, QuadraticBezierCurve = class extends Curve {
  constructor(v0 = new Vector2(), v1 = new Vector2(), v2 = new Vector2()) {
    super();
    this.type = "QuadraticBezierCurve", this.v0 = v0, this.v1 = v1, this.v2 = v2;
  }
  getPoint(t, optionalTarget = new Vector2()) {
    let point = optionalTarget, v0 = this.v0, v1 = this.v1, v2 = this.v2;
    return point.set(QuadraticBezier(t, v0.x, v1.x, v2.x), QuadraticBezier(t, v0.y, v1.y, v2.y)), point;
  }
  copy(source) {
    return super.copy(source), this.v0.copy(source.v0), this.v1.copy(source.v1), this.v2.copy(source.v2), this;
  }
  toJSON() {
    let data = super.toJSON();
    return data.v0 = this.v0.toArray(), data.v1 = this.v1.toArray(), data.v2 = this.v2.toArray(), data;
  }
  fromJSON(json) {
    return super.fromJSON(json), this.v0.fromArray(json.v0), this.v1.fromArray(json.v1), this.v2.fromArray(json.v2), this;
  }
};
QuadraticBezierCurve.prototype.isQuadraticBezierCurve = !0;
var QuadraticBezierCurve3 = class extends Curve {
  constructor(v0 = new Vector3(), v1 = new Vector3(), v2 = new Vector3()) {
    super();
    this.type = "QuadraticBezierCurve3", this.v0 = v0, this.v1 = v1, this.v2 = v2;
  }
  getPoint(t, optionalTarget = new Vector3()) {
    let point = optionalTarget, v0 = this.v0, v1 = this.v1, v2 = this.v2;
    return point.set(QuadraticBezier(t, v0.x, v1.x, v2.x), QuadraticBezier(t, v0.y, v1.y, v2.y), QuadraticBezier(t, v0.z, v1.z, v2.z)), point;
  }
  copy(source) {
    return super.copy(source), this.v0.copy(source.v0), this.v1.copy(source.v1), this.v2.copy(source.v2), this;
  }
  toJSON() {
    let data = super.toJSON();
    return data.v0 = this.v0.toArray(), data.v1 = this.v1.toArray(), data.v2 = this.v2.toArray(), data;
  }
  fromJSON(json) {
    return super.fromJSON(json), this.v0.fromArray(json.v0), this.v1.fromArray(json.v1), this.v2.fromArray(json.v2), this;
  }
};
QuadraticBezierCurve3.prototype.isQuadraticBezierCurve3 = !0;
var SplineCurve = class extends Curve {
  constructor(points = []) {
    super();
    this.type = "SplineCurve", this.points = points;
  }
  getPoint(t, optionalTarget = new Vector2()) {
    let point = optionalTarget, points = this.points, p = (points.length - 1) * t, intPoint = Math.floor(p), weight = p - intPoint, p0 = points[intPoint === 0 ? intPoint : intPoint - 1], p1 = points[intPoint], p2 = points[intPoint > points.length - 2 ? points.length - 1 : intPoint + 1], p3 = points[intPoint > points.length - 3 ? points.length - 1 : intPoint + 2];
    return point.set(CatmullRom(weight, p0.x, p1.x, p2.x, p3.x), CatmullRom(weight, p0.y, p1.y, p2.y, p3.y)), point;
  }
  copy(source) {
    super.copy(source), this.points = [];
    for (let i = 0, l = source.points.length; i < l; i++) {
      let point = source.points[i];
      this.points.push(point.clone());
    }
    return this;
  }
  toJSON() {
    let data = super.toJSON();
    data.points = [];
    for (let i = 0, l = this.points.length; i < l; i++) {
      let point = this.points[i];
      data.points.push(point.toArray());
    }
    return data;
  }
  fromJSON(json) {
    super.fromJSON(json), this.points = [];
    for (let i = 0, l = json.points.length; i < l; i++) {
      let point = json.points[i];
      this.points.push(new Vector2().fromArray(point));
    }
    return this;
  }
};
SplineCurve.prototype.isSplineCurve = !0;
var Curves = /* @__PURE__ */ Object.freeze({
  __proto__: null,
  ArcCurve,
  CatmullRomCurve3,
  CubicBezierCurve,
  CubicBezierCurve3,
  EllipseCurve,
  LineCurve,
  LineCurve3,
  QuadraticBezierCurve,
  QuadraticBezierCurve3,
  SplineCurve
}), CurvePath = class extends Curve {
  constructor() {
    super();
    this.type = "CurvePath", this.curves = [], this.autoClose = !1;
  }
  add(curve) {
    this.curves.push(curve);
  }
  closePath() {
    let startPoint = this.curves[0].getPoint(0), endPoint = this.curves[this.curves.length - 1].getPoint(1);
    startPoint.equals(endPoint) || this.curves.push(new LineCurve(endPoint, startPoint));
  }
  getPoint(t) {
    let d = t * this.getLength(), curveLengths = this.getCurveLengths(), i = 0;
    for (; i < curveLengths.length; ) {
      if (curveLengths[i] >= d) {
        let diff = curveLengths[i] - d, curve = this.curves[i], segmentLength = curve.getLength(), u = segmentLength === 0 ? 0 : 1 - diff / segmentLength;
        return curve.getPointAt(u);
      }
      i++;
    }
    return null;
  }
  getLength() {
    let lens = this.getCurveLengths();
    return lens[lens.length - 1];
  }
  updateArcLengths() {
    this.needsUpdate = !0, this.cacheLengths = null, this.getCurveLengths();
  }
  getCurveLengths() {
    if (this.cacheLengths && this.cacheLengths.length === this.curves.length)
      return this.cacheLengths;
    let lengths = [], sums = 0;
    for (let i = 0, l = this.curves.length; i < l; i++)
      sums += this.curves[i].getLength(), lengths.push(sums);
    return this.cacheLengths = lengths, lengths;
  }
  getSpacedPoints(divisions = 40) {
    let points = [];
    for (let i = 0; i <= divisions; i++)
      points.push(this.getPoint(i / divisions));
    return this.autoClose && points.push(points[0]), points;
  }
  getPoints(divisions = 12) {
    let points = [], last;
    for (let i = 0, curves = this.curves; i < curves.length; i++) {
      let curve = curves[i], resolution = curve && curve.isEllipseCurve ? divisions * 2 : curve && (curve.isLineCurve || curve.isLineCurve3) ? 1 : curve && curve.isSplineCurve ? divisions * curve.points.length : divisions, pts = curve.getPoints(resolution);
      for (let j = 0; j < pts.length; j++) {
        let point = pts[j];
        last && last.equals(point) || (points.push(point), last = point);
      }
    }
    return this.autoClose && points.length > 1 && !points[points.length - 1].equals(points[0]) && points.push(points[0]), points;
  }
  copy(source) {
    super.copy(source), this.curves = [];
    for (let i = 0, l = source.curves.length; i < l; i++) {
      let curve = source.curves[i];
      this.curves.push(curve.clone());
    }
    return this.autoClose = source.autoClose, this;
  }
  toJSON() {
    let data = super.toJSON();
    data.autoClose = this.autoClose, data.curves = [];
    for (let i = 0, l = this.curves.length; i < l; i++) {
      let curve = this.curves[i];
      data.curves.push(curve.toJSON());
    }
    return data;
  }
  fromJSON(json) {
    super.fromJSON(json), this.autoClose = json.autoClose, this.curves = [];
    for (let i = 0, l = json.curves.length; i < l; i++) {
      let curve = json.curves[i];
      this.curves.push(new Curves[curve.type]().fromJSON(curve));
    }
    return this;
  }
}, Path = class extends CurvePath {
  constructor(points) {
    super();
    this.type = "Path", this.currentPoint = new Vector2(), points && this.setFromPoints(points);
  }
  setFromPoints(points) {
    this.moveTo(points[0].x, points[0].y);
    for (let i = 1, l = points.length; i < l; i++)
      this.lineTo(points[i].x, points[i].y);
    return this;
  }
  moveTo(x, y) {
    return this.currentPoint.set(x, y), this;
  }
  lineTo(x, y) {
    let curve = new LineCurve(this.currentPoint.clone(), new Vector2(x, y));
    return this.curves.push(curve), this.currentPoint.set(x, y), this;
  }
  quadraticCurveTo(aCPx, aCPy, aX, aY) {
    let curve = new QuadraticBezierCurve(this.currentPoint.clone(), new Vector2(aCPx, aCPy), new Vector2(aX, aY));
    return this.curves.push(curve), this.currentPoint.set(aX, aY), this;
  }
  bezierCurveTo(aCP1x, aCP1y, aCP2x, aCP2y, aX, aY) {
    let curve = new CubicBezierCurve(this.currentPoint.clone(), new Vector2(aCP1x, aCP1y), new Vector2(aCP2x, aCP2y), new Vector2(aX, aY));
    return this.curves.push(curve), this.currentPoint.set(aX, aY), this;
  }
  splineThru(pts) {
    let npts = [this.currentPoint.clone()].concat(pts), curve = new SplineCurve(npts);
    return this.curves.push(curve), this.currentPoint.copy(pts[pts.length - 1]), this;
  }
  arc(aX, aY, aRadius, aStartAngle, aEndAngle, aClockwise) {
    let x0 = this.currentPoint.x, y0 = this.currentPoint.y;
    return this.absarc(aX + x0, aY + y0, aRadius, aStartAngle, aEndAngle, aClockwise), this;
  }
  absarc(aX, aY, aRadius, aStartAngle, aEndAngle, aClockwise) {
    return this.absellipse(aX, aY, aRadius, aRadius, aStartAngle, aEndAngle, aClockwise), this;
  }
  ellipse(aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation) {
    let x0 = this.currentPoint.x, y0 = this.currentPoint.y;
    return this.absellipse(aX + x0, aY + y0, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation), this;
  }
  absellipse(aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation) {
    let curve = new EllipseCurve(aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation);
    if (this.curves.length > 0) {
      let firstPoint = curve.getPoint(0);
      firstPoint.equals(this.currentPoint) || this.lineTo(firstPoint.x, firstPoint.y);
    }
    this.curves.push(curve);
    let lastPoint = curve.getPoint(1);
    return this.currentPoint.copy(lastPoint), this;
  }
  copy(source) {
    return super.copy(source), this.currentPoint.copy(source.currentPoint), this;
  }
  toJSON() {
    let data = super.toJSON();
    return data.currentPoint = this.currentPoint.toArray(), data;
  }
  fromJSON(json) {
    return super.fromJSON(json), this.currentPoint.fromArray(json.currentPoint), this;
  }
}, Shape = class extends Path {
  constructor(points) {
    super(points);
    this.uuid = generateUUID(), this.type = "Shape", this.holes = [];
  }
  getPointsHoles(divisions) {
    let holesPts = [];
    for (let i = 0, l = this.holes.length; i < l; i++)
      holesPts[i] = this.holes[i].getPoints(divisions);
    return holesPts;
  }
  extractPoints(divisions) {
    return {
      shape: this.getPoints(divisions),
      holes: this.getPointsHoles(divisions)
    };
  }
  copy(source) {
    super.copy(source), this.holes = [];
    for (let i = 0, l = source.holes.length; i < l; i++) {
      let hole = source.holes[i];
      this.holes.push(hole.clone());
    }
    return this;
  }
  toJSON() {
    let data = super.toJSON();
    data.uuid = this.uuid, data.holes = [];
    for (let i = 0, l = this.holes.length; i < l; i++) {
      let hole = this.holes[i];
      data.holes.push(hole.toJSON());
    }
    return data;
  }
  fromJSON(json) {
    super.fromJSON(json), this.uuid = json.uuid, this.holes = [];
    for (let i = 0, l = json.holes.length; i < l; i++) {
      let hole = json.holes[i];
      this.holes.push(new Path().fromJSON(hole));
    }
    return this;
  }
}, Light = class extends Object3D {
  constructor(color, intensity = 1) {
    super();
    this.type = "Light", this.color = new Color(color), this.intensity = intensity;
  }
  dispose() {
  }
  copy(source) {
    return super.copy(source), this.color.copy(source.color), this.intensity = source.intensity, this;
  }
  toJSON(meta) {
    let data = super.toJSON(meta);
    return data.object.color = this.color.getHex(), data.object.intensity = this.intensity, this.groundColor !== void 0 && (data.object.groundColor = this.groundColor.getHex()), this.distance !== void 0 && (data.object.distance = this.distance), this.angle !== void 0 && (data.object.angle = this.angle), this.decay !== void 0 && (data.object.decay = this.decay), this.penumbra !== void 0 && (data.object.penumbra = this.penumbra), this.shadow !== void 0 && (data.object.shadow = this.shadow.toJSON()), data;
  }
};
Light.prototype.isLight = !0;
var HemisphereLight = class extends Light {
  constructor(skyColor, groundColor, intensity) {
    super(skyColor, intensity);
    this.type = "HemisphereLight", this.position.copy(Object3D.DefaultUp), this.updateMatrix(), this.groundColor = new Color(groundColor);
  }
  copy(source) {
    return Light.prototype.copy.call(this, source), this.groundColor.copy(source.groundColor), this;
  }
};
HemisphereLight.prototype.isHemisphereLight = !0;
var _projScreenMatrix$1 = /* @__PURE__ */ new Matrix4(), _lightPositionWorld$1 = /* @__PURE__ */ new Vector3(), _lookTarget$1 = /* @__PURE__ */ new Vector3(), LightShadow = class {
  constructor(camera) {
    this.camera = camera, this.bias = 0, this.normalBias = 0, this.radius = 1, this.mapSize = new Vector2(512, 512), this.map = null, this.mapPass = null, this.matrix = new Matrix4(), this.autoUpdate = !0, this.needsUpdate = !1, this._frustum = new Frustum(), this._frameExtents = new Vector2(1, 1), this._viewportCount = 1, this._viewports = [
      new Vector4(0, 0, 1, 1)
    ];
  }
  getViewportCount() {
    return this._viewportCount;
  }
  getFrustum() {
    return this._frustum;
  }
  updateMatrices(light) {
    let shadowCamera = this.camera, shadowMatrix = this.matrix;
    _lightPositionWorld$1.setFromMatrixPosition(light.matrixWorld), shadowCamera.position.copy(_lightPositionWorld$1), _lookTarget$1.setFromMatrixPosition(light.target.matrixWorld), shadowCamera.lookAt(_lookTarget$1), shadowCamera.updateMatrixWorld(), _projScreenMatrix$1.multiplyMatrices(shadowCamera.projectionMatrix, shadowCamera.matrixWorldInverse), this._frustum.setFromProjectionMatrix(_projScreenMatrix$1), shadowMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1), shadowMatrix.multiply(shadowCamera.projectionMatrix), shadowMatrix.multiply(shadowCamera.matrixWorldInverse);
  }
  getViewport(viewportIndex) {
    return this._viewports[viewportIndex];
  }
  getFrameExtents() {
    return this._frameExtents;
  }
  dispose() {
    this.map && this.map.dispose(), this.mapPass && this.mapPass.dispose();
  }
  copy(source) {
    return this.camera = source.camera.clone(), this.bias = source.bias, this.radius = source.radius, this.mapSize.copy(source.mapSize), this;
  }
  clone() {
    return new this.constructor().copy(this);
  }
  toJSON() {
    let object = {};
    return this.bias !== 0 && (object.bias = this.bias), this.normalBias !== 0 && (object.normalBias = this.normalBias), this.radius !== 1 && (object.radius = this.radius), (this.mapSize.x !== 512 || this.mapSize.y !== 512) && (object.mapSize = this.mapSize.toArray()), object.camera = this.camera.toJSON(!1).object, delete object.camera.matrix, object;
  }
}, SpotLightShadow = class extends LightShadow {
  constructor() {
    super(new PerspectiveCamera(50, 1, 0.5, 500));
    this.focus = 1;
  }
  updateMatrices(light) {
    let camera = this.camera, fov2 = RAD2DEG * 2 * light.angle * this.focus, aspect2 = this.mapSize.width / this.mapSize.height, far = light.distance || camera.far;
    (fov2 !== camera.fov || aspect2 !== camera.aspect || far !== camera.far) && (camera.fov = fov2, camera.aspect = aspect2, camera.far = far, camera.updateProjectionMatrix()), super.updateMatrices(light);
  }
  copy(source) {
    return super.copy(source), this.focus = source.focus, this;
  }
};
SpotLightShadow.prototype.isSpotLightShadow = !0;
var SpotLight = class extends Light {
  constructor(color, intensity, distance = 0, angle = Math.PI / 3, penumbra = 0, decay = 1) {
    super(color, intensity);
    this.type = "SpotLight", this.position.copy(Object3D.DefaultUp), this.updateMatrix(), this.target = new Object3D(), this.distance = distance, this.angle = angle, this.penumbra = penumbra, this.decay = decay, this.shadow = new SpotLightShadow();
  }
  get power() {
    return this.intensity * Math.PI;
  }
  set power(power) {
    this.intensity = power / Math.PI;
  }
  dispose() {
    this.shadow.dispose();
  }
  copy(source) {
    return super.copy(source), this.distance = source.distance, this.angle = source.angle, this.penumbra = source.penumbra, this.decay = source.decay, this.target = source.target.clone(), this.shadow = source.shadow.clone(), this;
  }
};
SpotLight.prototype.isSpotLight = !0;
var _projScreenMatrix = /* @__PURE__ */ new Matrix4(), _lightPositionWorld = /* @__PURE__ */ new Vector3(), _lookTarget = /* @__PURE__ */ new Vector3(), PointLightShadow = class extends LightShadow {
  constructor() {
    super(new PerspectiveCamera(90, 1, 0.5, 500));
    this._frameExtents = new Vector2(4, 2), this._viewportCount = 6, this._viewports = [
      new Vector4(2, 1, 1, 1),
      new Vector4(0, 1, 1, 1),
      new Vector4(3, 1, 1, 1),
      new Vector4(1, 1, 1, 1),
      new Vector4(3, 0, 1, 1),
      new Vector4(1, 0, 1, 1)
    ], this._cubeDirections = [
      new Vector3(1, 0, 0),
      new Vector3(-1, 0, 0),
      new Vector3(0, 0, 1),
      new Vector3(0, 0, -1),
      new Vector3(0, 1, 0),
      new Vector3(0, -1, 0)
    ], this._cubeUps = [
      new Vector3(0, 1, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 1),
      new Vector3(0, 0, -1)
    ];
  }
  updateMatrices(light, viewportIndex = 0) {
    let camera = this.camera, shadowMatrix = this.matrix, far = light.distance || camera.far;
    far !== camera.far && (camera.far = far, camera.updateProjectionMatrix()), _lightPositionWorld.setFromMatrixPosition(light.matrixWorld), camera.position.copy(_lightPositionWorld), _lookTarget.copy(camera.position), _lookTarget.add(this._cubeDirections[viewportIndex]), camera.up.copy(this._cubeUps[viewportIndex]), camera.lookAt(_lookTarget), camera.updateMatrixWorld(), shadowMatrix.makeTranslation(-_lightPositionWorld.x, -_lightPositionWorld.y, -_lightPositionWorld.z), _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), this._frustum.setFromProjectionMatrix(_projScreenMatrix);
  }
};
PointLightShadow.prototype.isPointLightShadow = !0;
var PointLight = class extends Light {
  constructor(color, intensity, distance = 0, decay = 1) {
    super(color, intensity);
    this.type = "PointLight", this.distance = distance, this.decay = decay, this.shadow = new PointLightShadow();
  }
  get power() {
    return this.intensity * 4 * Math.PI;
  }
  set power(power) {
    this.intensity = power / (4 * Math.PI);
  }
  dispose() {
    this.shadow.dispose();
  }
  copy(source) {
    return super.copy(source), this.distance = source.distance, this.decay = source.decay, this.shadow = source.shadow.clone(), this;
  }
};
PointLight.prototype.isPointLight = !0;
var OrthographicCamera = class extends Camera {
  constructor(left = -1, right = 1, top = 1, bottom = -1, near = 0.1, far = 2e3) {
    super();
    this.type = "OrthographicCamera", this.zoom = 1, this.view = null, this.left = left, this.right = right, this.top = top, this.bottom = bottom, this.near = near, this.far = far, this.updateProjectionMatrix();
  }
  copy(source, recursive) {
    return super.copy(source, recursive), this.left = source.left, this.right = source.right, this.top = source.top, this.bottom = source.bottom, this.near = source.near, this.far = source.far, this.zoom = source.zoom, this.view = source.view === null ? null : Object.assign({}, source.view), this;
  }
  setViewOffset(fullWidth, fullHeight, x, y, width, height) {
    this.view === null && (this.view = {
      enabled: !0,
      fullWidth: 1,
      fullHeight: 1,
      offsetX: 0,
      offsetY: 0,
      width: 1,
      height: 1
    }), this.view.enabled = !0, this.view.fullWidth = fullWidth, this.view.fullHeight = fullHeight, this.view.offsetX = x, this.view.offsetY = y, this.view.width = width, this.view.height = height, this.updateProjectionMatrix();
  }
  clearViewOffset() {
    this.view !== null && (this.view.enabled = !1), this.updateProjectionMatrix();
  }
  updateProjectionMatrix() {
    let dx = (this.right - this.left) / (2 * this.zoom), dy = (this.top - this.bottom) / (2 * this.zoom), cx = (this.right + this.left) / 2, cy = (this.top + this.bottom) / 2, left = cx - dx, right = cx + dx, top = cy + dy, bottom = cy - dy;
    if (this.view !== null && this.view.enabled) {
      let scaleW = (this.right - this.left) / this.view.fullWidth / this.zoom, scaleH = (this.top - this.bottom) / this.view.fullHeight / this.zoom;
      left += scaleW * this.view.offsetX, right = left + scaleW * this.view.width, top -= scaleH * this.view.offsetY, bottom = top - scaleH * this.view.height;
    }
    this.projectionMatrix.makeOrthographic(left, right, top, bottom, this.near, this.far), this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
  toJSON(meta) {
    let data = super.toJSON(meta);
    return data.object.zoom = this.zoom, data.object.left = this.left, data.object.right = this.right, data.object.top = this.top, data.object.bottom = this.bottom, data.object.near = this.near, data.object.far = this.far, this.view !== null && (data.object.view = Object.assign({}, this.view)), data;
  }
};
OrthographicCamera.prototype.isOrthographicCamera = !0;
var DirectionalLightShadow = class extends LightShadow {
  constructor() {
    super(new OrthographicCamera(-5, 5, 5, -5, 0.5, 500));
  }
};
DirectionalLightShadow.prototype.isDirectionalLightShadow = !0;
var DirectionalLight = class extends Light {
  constructor(color, intensity) {
    super(color, intensity);
    this.type = "DirectionalLight", this.position.copy(Object3D.DefaultUp), this.updateMatrix(), this.target = new Object3D(), this.shadow = new DirectionalLightShadow();
  }
  dispose() {
    this.shadow.dispose();
  }
  copy(source) {
    return super.copy(source), this.target = source.target.clone(), this.shadow = source.shadow.clone(), this;
  }
};
DirectionalLight.prototype.isDirectionalLight = !0;
var AmbientLight = class extends Light {
  constructor(color, intensity) {
    super(color, intensity);
    this.type = "AmbientLight";
  }
};
AmbientLight.prototype.isAmbientLight = !0;
var RectAreaLight = class extends Light {
  constructor(color, intensity, width = 10, height = 10) {
    super(color, intensity);
    this.type = "RectAreaLight", this.width = width, this.height = height;
  }
  copy(source) {
    return super.copy(source), this.width = source.width, this.height = source.height, this;
  }
  toJSON(meta) {
    let data = super.toJSON(meta);
    return data.object.width = this.width, data.object.height = this.height, data;
  }
};
RectAreaLight.prototype.isRectAreaLight = !0;
var SphericalHarmonics3 = class {
  constructor() {
    this.coefficients = [];
    for (let i = 0; i < 9; i++)
      this.coefficients.push(new Vector3());
  }
  set(coefficients) {
    for (let i = 0; i < 9; i++)
      this.coefficients[i].copy(coefficients[i]);
    return this;
  }
  zero() {
    for (let i = 0; i < 9; i++)
      this.coefficients[i].set(0, 0, 0);
    return this;
  }
  getAt(normal, target) {
    let x = normal.x, y = normal.y, z = normal.z, coeff = this.coefficients;
    return target.copy(coeff[0]).multiplyScalar(0.282095), target.addScaledVector(coeff[1], 0.488603 * y), target.addScaledVector(coeff[2], 0.488603 * z), target.addScaledVector(coeff[3], 0.488603 * x), target.addScaledVector(coeff[4], 1.092548 * (x * y)), target.addScaledVector(coeff[5], 1.092548 * (y * z)), target.addScaledVector(coeff[6], 0.315392 * (3 * z * z - 1)), target.addScaledVector(coeff[7], 1.092548 * (x * z)), target.addScaledVector(coeff[8], 0.546274 * (x * x - y * y)), target;
  }
  getIrradianceAt(normal, target) {
    let x = normal.x, y = normal.y, z = normal.z, coeff = this.coefficients;
    return target.copy(coeff[0]).multiplyScalar(0.886227), target.addScaledVector(coeff[1], 2 * 0.511664 * y), target.addScaledVector(coeff[2], 2 * 0.511664 * z), target.addScaledVector(coeff[3], 2 * 0.511664 * x), target.addScaledVector(coeff[4], 2 * 0.429043 * x * y), target.addScaledVector(coeff[5], 2 * 0.429043 * y * z), target.addScaledVector(coeff[6], 0.743125 * z * z - 0.247708), target.addScaledVector(coeff[7], 2 * 0.429043 * x * z), target.addScaledVector(coeff[8], 0.429043 * (x * x - y * y)), target;
  }
  add(sh) {
    for (let i = 0; i < 9; i++)
      this.coefficients[i].add(sh.coefficients[i]);
    return this;
  }
  addScaledSH(sh, s) {
    for (let i = 0; i < 9; i++)
      this.coefficients[i].addScaledVector(sh.coefficients[i], s);
    return this;
  }
  scale(s) {
    for (let i = 0; i < 9; i++)
      this.coefficients[i].multiplyScalar(s);
    return this;
  }
  lerp(sh, alpha) {
    for (let i = 0; i < 9; i++)
      this.coefficients[i].lerp(sh.coefficients[i], alpha);
    return this;
  }
  equals(sh) {
    for (let i = 0; i < 9; i++)
      if (!this.coefficients[i].equals(sh.coefficients[i]))
        return !1;
    return !0;
  }
  copy(sh) {
    return this.set(sh.coefficients);
  }
  clone() {
    return new this.constructor().copy(this);
  }
  fromArray(array, offset = 0) {
    let coefficients = this.coefficients;
    for (let i = 0; i < 9; i++)
      coefficients[i].fromArray(array, offset + i * 3);
    return this;
  }
  toArray(array = [], offset = 0) {
    let coefficients = this.coefficients;
    for (let i = 0; i < 9; i++)
      coefficients[i].toArray(array, offset + i * 3);
    return array;
  }
  static getBasisAt(normal, shBasis) {
    let x = normal.x, y = normal.y, z = normal.z;
    shBasis[0] = 0.282095, shBasis[1] = 0.488603 * y, shBasis[2] = 0.488603 * z, shBasis[3] = 0.488603 * x, shBasis[4] = 1.092548 * x * y, shBasis[5] = 1.092548 * y * z, shBasis[6] = 0.315392 * (3 * z * z - 1), shBasis[7] = 1.092548 * x * z, shBasis[8] = 0.546274 * (x * x - y * y);
  }
};
SphericalHarmonics3.prototype.isSphericalHarmonics3 = !0;
var LightProbe = class extends Light {
  constructor(sh = new SphericalHarmonics3(), intensity = 1) {
    super(void 0, intensity);
    this.sh = sh;
  }
  copy(source) {
    return super.copy(source), this.sh.copy(source.sh), this;
  }
  fromJSON(json) {
    return this.intensity = json.intensity, this.sh.fromArray(json.sh), this;
  }
  toJSON(meta) {
    let data = super.toJSON(meta);
    return data.object.sh = this.sh.toArray(), data;
  }
};
LightProbe.prototype.isLightProbe = !0;
var LoaderUtils = class {
  static decodeText(array) {
    if (typeof TextDecoder != "undefined")
      return new TextDecoder().decode(array);
    let s = "";
    for (let i = 0, il = array.length; i < il; i++)
      s += String.fromCharCode(array[i]);
    try {
      return decodeURIComponent(escape(s));
    } catch (e) {
      return s;
    }
  }
  static extractUrlBase(url) {
    let index = url.lastIndexOf("/");
    return index === -1 ? "./" : url.substr(0, index + 1);
  }
}, InstancedBufferGeometry = class extends BufferGeometry {
  constructor() {
    super();
    this.type = "InstancedBufferGeometry", this.instanceCount = Infinity;
  }
  copy(source) {
    return super.copy(source), this.instanceCount = source.instanceCount, this;
  }
  clone() {
    return new this.constructor().copy(this);
  }
  toJSON() {
    let data = super.toJSON(this);
    return data.instanceCount = this.instanceCount, data.isInstancedBufferGeometry = !0, data;
  }
};
InstancedBufferGeometry.prototype.isInstancedBufferGeometry = !0;
var InstancedBufferAttribute = class extends BufferAttribute {
  constructor(array, itemSize, normalized, meshPerAttribute) {
    typeof normalized == "number" && (meshPerAttribute = normalized, normalized = !1, console.error("THREE.InstancedBufferAttribute: The constructor now expects normalized as the third argument.")), super(array, itemSize, normalized), this.meshPerAttribute = meshPerAttribute || 1;
  }
  copy(source) {
    return super.copy(source), this.meshPerAttribute = source.meshPerAttribute, this;
  }
  toJSON() {
    let data = super.toJSON();
    return data.meshPerAttribute = this.meshPerAttribute, data.isInstancedBufferAttribute = !0, data;
  }
};
InstancedBufferAttribute.prototype.isInstancedBufferAttribute = !0;
var ImageBitmapLoader = class extends Loader {
  constructor(manager) {
    super(manager);
    typeof createImageBitmap == "undefined" && console.warn("THREE.ImageBitmapLoader: createImageBitmap() not supported."), typeof fetch == "undefined" && console.warn("THREE.ImageBitmapLoader: fetch() not supported."), this.options = { premultiplyAlpha: "none" };
  }
  setOptions(options) {
    return this.options = options, this;
  }
  load(url, onLoad, onProgress, onError) {
    url === void 0 && (url = ""), this.path !== void 0 && (url = this.path + url), url = this.manager.resolveURL(url);
    let scope = this, cached = Cache.get(url);
    if (cached !== void 0)
      return scope.manager.itemStart(url), setTimeout(function() {
        onLoad && onLoad(cached), scope.manager.itemEnd(url);
      }, 0), cached;
    let fetchOptions = {};
    fetchOptions.credentials = this.crossOrigin === "anonymous" ? "same-origin" : "include", fetchOptions.headers = this.requestHeader, fetch(url, fetchOptions).then(function(res) {
      return res.blob();
    }).then(function(blob) {
      return createImageBitmap(blob, Object.assign(scope.options, { colorSpaceConversion: "none" }));
    }).then(function(imageBitmap) {
      Cache.add(url, imageBitmap), onLoad && onLoad(imageBitmap), scope.manager.itemEnd(url);
    }).catch(function(e) {
      onError && onError(e), scope.manager.itemError(url), scope.manager.itemEnd(url);
    }), scope.manager.itemStart(url);
  }
};
ImageBitmapLoader.prototype.isImageBitmapLoader = !0;
var ShapePath = class {
  constructor() {
    this.type = "ShapePath", this.color = new Color(), this.subPaths = [], this.currentPath = null;
  }
  moveTo(x, y) {
    return this.currentPath = new Path(), this.subPaths.push(this.currentPath), this.currentPath.moveTo(x, y), this;
  }
  lineTo(x, y) {
    return this.currentPath.lineTo(x, y), this;
  }
  quadraticCurveTo(aCPx, aCPy, aX, aY) {
    return this.currentPath.quadraticCurveTo(aCPx, aCPy, aX, aY), this;
  }
  bezierCurveTo(aCP1x, aCP1y, aCP2x, aCP2y, aX, aY) {
    return this.currentPath.bezierCurveTo(aCP1x, aCP1y, aCP2x, aCP2y, aX, aY), this;
  }
  splineThru(pts) {
    return this.currentPath.splineThru(pts), this;
  }
  toShapes(isCCW, noHoles) {
    function toShapesNoHoles(inSubpaths) {
      let shapes2 = [];
      for (let i = 0, l = inSubpaths.length; i < l; i++) {
        let tmpPath2 = inSubpaths[i], tmpShape2 = new Shape();
        tmpShape2.curves = tmpPath2.curves, shapes2.push(tmpShape2);
      }
      return shapes2;
    }
    function isPointInsidePolygon(inPt, inPolygon) {
      let polyLen = inPolygon.length, inside = !1;
      for (let p = polyLen - 1, q = 0; q < polyLen; p = q++) {
        let edgeLowPt = inPolygon[p], edgeHighPt = inPolygon[q], edgeDx = edgeHighPt.x - edgeLowPt.x, edgeDy = edgeHighPt.y - edgeLowPt.y;
        if (Math.abs(edgeDy) > Number.EPSILON) {
          if (edgeDy < 0 && (edgeLowPt = inPolygon[q], edgeDx = -edgeDx, edgeHighPt = inPolygon[p], edgeDy = -edgeDy), inPt.y < edgeLowPt.y || inPt.y > edgeHighPt.y)
            continue;
          if (inPt.y === edgeLowPt.y) {
            if (inPt.x === edgeLowPt.x)
              return !0;
          } else {
            let perpEdge = edgeDy * (inPt.x - edgeLowPt.x) - edgeDx * (inPt.y - edgeLowPt.y);
            if (perpEdge === 0)
              return !0;
            if (perpEdge < 0)
              continue;
            inside = !inside;
          }
        } else {
          if (inPt.y !== edgeLowPt.y)
            continue;
          if (edgeHighPt.x <= inPt.x && inPt.x <= edgeLowPt.x || edgeLowPt.x <= inPt.x && inPt.x <= edgeHighPt.x)
            return !0;
        }
      }
      return inside;
    }
    let isClockWise = ShapeUtils.isClockWise, subPaths = this.subPaths;
    if (subPaths.length === 0)
      return [];
    if (noHoles === !0)
      return toShapesNoHoles(subPaths);
    let solid, tmpPath, tmpShape, shapes = [];
    if (subPaths.length === 1)
      return tmpPath = subPaths[0], tmpShape = new Shape(), tmpShape.curves = tmpPath.curves, shapes.push(tmpShape), shapes;
    let holesFirst = !isClockWise(subPaths[0].getPoints());
    holesFirst = isCCW ? !holesFirst : holesFirst;
    let betterShapeHoles = [], newShapes = [], newShapeHoles = [], mainIdx = 0, tmpPoints;
    newShapes[mainIdx] = void 0, newShapeHoles[mainIdx] = [];
    for (let i = 0, l = subPaths.length; i < l; i++)
      tmpPath = subPaths[i], tmpPoints = tmpPath.getPoints(), solid = isClockWise(tmpPoints), solid = isCCW ? !solid : solid, solid ? (!holesFirst && newShapes[mainIdx] && mainIdx++, newShapes[mainIdx] = { s: new Shape(), p: tmpPoints }, newShapes[mainIdx].s.curves = tmpPath.curves, holesFirst && mainIdx++, newShapeHoles[mainIdx] = []) : newShapeHoles[mainIdx].push({ h: tmpPath, p: tmpPoints[0] });
    if (!newShapes[0])
      return toShapesNoHoles(subPaths);
    if (newShapes.length > 1) {
      let ambiguous = !1, toChange = [];
      for (let sIdx = 0, sLen = newShapes.length; sIdx < sLen; sIdx++)
        betterShapeHoles[sIdx] = [];
      for (let sIdx = 0, sLen = newShapes.length; sIdx < sLen; sIdx++) {
        let sho = newShapeHoles[sIdx];
        for (let hIdx = 0; hIdx < sho.length; hIdx++) {
          let ho = sho[hIdx], hole_unassigned = !0;
          for (let s2Idx = 0; s2Idx < newShapes.length; s2Idx++)
            isPointInsidePolygon(ho.p, newShapes[s2Idx].p) && (sIdx !== s2Idx && toChange.push({ froms: sIdx, tos: s2Idx, hole: hIdx }), hole_unassigned ? (hole_unassigned = !1, betterShapeHoles[s2Idx].push(ho)) : ambiguous = !0);
          hole_unassigned && betterShapeHoles[sIdx].push(ho);
        }
      }
      toChange.length > 0 && (ambiguous || (newShapeHoles = betterShapeHoles));
    }
    let tmpHoles;
    for (let i = 0, il = newShapes.length; i < il; i++) {
      tmpShape = newShapes[i].s, shapes.push(tmpShape), tmpHoles = newShapeHoles[i];
      for (let j = 0, jl = tmpHoles.length; j < jl; j++)
        tmpShape.holes.push(tmpHoles[j].h);
    }
    return shapes;
  }
}, Font = class {
  constructor(data) {
    this.type = "Font", this.data = data;
  }
  generateShapes(text, size = 100) {
    let shapes = [], paths = createPaths(text, size, this.data);
    for (let p = 0, pl = paths.length; p < pl; p++)
      Array.prototype.push.apply(shapes, paths[p].toShapes());
    return shapes;
  }
};
function createPaths(text, size, data) {
  let chars = Array.from(text), scale = size / data.resolution, line_height = (data.boundingBox.yMax - data.boundingBox.yMin + data.underlineThickness) * scale, paths = [], offsetX = 0, offsetY = 0;
  for (let i = 0; i < chars.length; i++) {
    let char = chars[i];
    if (char === `
`)
      offsetX = 0, offsetY -= line_height;
    else {
      let ret = createPath(char, scale, offsetX, offsetY, data);
      offsetX += ret.offsetX, paths.push(ret.path);
    }
  }
  return paths;
}
function createPath(char, scale, offsetX, offsetY, data) {
  let glyph = data.glyphs[char] || data.glyphs["?"];
  if (!glyph) {
    console.error('THREE.Font: character "' + char + '" does not exists in font family ' + data.familyName + ".");
    return;
  }
  let path = new ShapePath(), x, y, cpx, cpy, cpx1, cpy1, cpx2, cpy2;
  if (glyph.o) {
    let outline = glyph._cachedOutline || (glyph._cachedOutline = glyph.o.split(" "));
    for (let i = 0, l = outline.length; i < l; )
      switch (outline[i++]) {
        case "m":
          x = outline[i++] * scale + offsetX, y = outline[i++] * scale + offsetY, path.moveTo(x, y);
          break;
        case "l":
          x = outline[i++] * scale + offsetX, y = outline[i++] * scale + offsetY, path.lineTo(x, y);
          break;
        case "q":
          cpx = outline[i++] * scale + offsetX, cpy = outline[i++] * scale + offsetY, cpx1 = outline[i++] * scale + offsetX, cpy1 = outline[i++] * scale + offsetY, path.quadraticCurveTo(cpx1, cpy1, cpx, cpy);
          break;
        case "b":
          cpx = outline[i++] * scale + offsetX, cpy = outline[i++] * scale + offsetY, cpx1 = outline[i++] * scale + offsetX, cpy1 = outline[i++] * scale + offsetY, cpx2 = outline[i++] * scale + offsetX, cpy2 = outline[i++] * scale + offsetY, path.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, cpx, cpy);
          break;
      }
  }
  return { offsetX: glyph.ha * scale, path };
}
Font.prototype.isFont = !0;
var _context, AudioContext = {
  getContext: function() {
    return _context === void 0 && (_context = new (window.AudioContext || window.webkitAudioContext)()), _context;
  },
  setContext: function(value) {
    _context = value;
  }
}, AudioLoader = class extends Loader {
  constructor(manager) {
    super(manager);
  }
  load(url, onLoad, onProgress, onError) {
    let scope = this, loader = new FileLoader(this.manager);
    loader.setResponseType("arraybuffer"), loader.setPath(this.path), loader.setRequestHeader(this.requestHeader), loader.setWithCredentials(this.withCredentials), loader.load(url, function(buffer) {
      try {
        let bufferCopy = buffer.slice(0);
        AudioContext.getContext().decodeAudioData(bufferCopy, function(audioBuffer) {
          onLoad(audioBuffer);
        });
      } catch (e) {
        onError ? onError(e) : console.error(e), scope.manager.itemError(url);
      }
    }, onProgress, onError);
  }
}, HemisphereLightProbe = class extends LightProbe {
  constructor(skyColor, groundColor, intensity = 1) {
    super(void 0, intensity);
    let color1 = new Color().set(skyColor), color2 = new Color().set(groundColor), sky = new Vector3(color1.r, color1.g, color1.b), ground = new Vector3(color2.r, color2.g, color2.b), c0 = Math.sqrt(Math.PI), c1 = c0 * Math.sqrt(0.75);
    this.sh.coefficients[0].copy(sky).add(ground).multiplyScalar(c0), this.sh.coefficients[1].copy(sky).sub(ground).multiplyScalar(c1);
  }
};
HemisphereLightProbe.prototype.isHemisphereLightProbe = !0;
var AmbientLightProbe = class extends LightProbe {
  constructor(color, intensity = 1) {
    super(void 0, intensity);
    let color1 = new Color().set(color);
    this.sh.coefficients[0].set(color1.r, color1.g, color1.b).multiplyScalar(2 * Math.sqrt(Math.PI));
  }
};
AmbientLightProbe.prototype.isAmbientLightProbe = !0;
var Audio = class extends Object3D {
  constructor(listener) {
    super();
    this.type = "Audio", this.listener = listener, this.context = listener.context, this.gain = this.context.createGain(), this.gain.connect(listener.getInput()), this.autoplay = !1, this.buffer = null, this.detune = 0, this.loop = !1, this.loopStart = 0, this.loopEnd = 0, this.offset = 0, this.duration = void 0, this.playbackRate = 1, this.isPlaying = !1, this.hasPlaybackControl = !0, this.source = null, this.sourceType = "empty", this._startedAt = 0, this._progress = 0, this._connected = !1, this.filters = [];
  }
  getOutput() {
    return this.gain;
  }
  setNodeSource(audioNode) {
    return this.hasPlaybackControl = !1, this.sourceType = "audioNode", this.source = audioNode, this.connect(), this;
  }
  setMediaElementSource(mediaElement) {
    return this.hasPlaybackControl = !1, this.sourceType = "mediaNode", this.source = this.context.createMediaElementSource(mediaElement), this.connect(), this;
  }
  setMediaStreamSource(mediaStream) {
    return this.hasPlaybackControl = !1, this.sourceType = "mediaStreamNode", this.source = this.context.createMediaStreamSource(mediaStream), this.connect(), this;
  }
  setBuffer(audioBuffer) {
    return this.buffer = audioBuffer, this.sourceType = "buffer", this.autoplay && this.play(), this;
  }
  play(delay = 0) {
    if (this.isPlaying === !0) {
      console.warn("THREE.Audio: Audio is already playing.");
      return;
    }
    if (this.hasPlaybackControl === !1) {
      console.warn("THREE.Audio: this Audio has no playback control.");
      return;
    }
    this._startedAt = this.context.currentTime + delay;
    let source = this.context.createBufferSource();
    return source.buffer = this.buffer, source.loop = this.loop, source.loopStart = this.loopStart, source.loopEnd = this.loopEnd, source.onended = this.onEnded.bind(this), source.start(this._startedAt, this._progress + this.offset, this.duration), this.isPlaying = !0, this.source = source, this.setDetune(this.detune), this.setPlaybackRate(this.playbackRate), this.connect();
  }
  pause() {
    if (this.hasPlaybackControl === !1) {
      console.warn("THREE.Audio: this Audio has no playback control.");
      return;
    }
    return this.isPlaying === !0 && (this._progress += Math.max(this.context.currentTime - this._startedAt, 0) * this.playbackRate, this.loop === !0 && (this._progress = this._progress % (this.duration || this.buffer.duration)), this.source.stop(), this.source.onended = null, this.isPlaying = !1), this;
  }
  stop() {
    if (this.hasPlaybackControl === !1) {
      console.warn("THREE.Audio: this Audio has no playback control.");
      return;
    }
    return this._progress = 0, this.source.stop(), this.source.onended = null, this.isPlaying = !1, this;
  }
  connect() {
    if (this.filters.length > 0) {
      this.source.connect(this.filters[0]);
      for (let i = 1, l = this.filters.length; i < l; i++)
        this.filters[i - 1].connect(this.filters[i]);
      this.filters[this.filters.length - 1].connect(this.getOutput());
    } else
      this.source.connect(this.getOutput());
    return this._connected = !0, this;
  }
  disconnect() {
    if (this.filters.length > 0) {
      this.source.disconnect(this.filters[0]);
      for (let i = 1, l = this.filters.length; i < l; i++)
        this.filters[i - 1].disconnect(this.filters[i]);
      this.filters[this.filters.length - 1].disconnect(this.getOutput());
    } else
      this.source.disconnect(this.getOutput());
    return this._connected = !1, this;
  }
  getFilters() {
    return this.filters;
  }
  setFilters(value) {
    return value || (value = []), this._connected === !0 ? (this.disconnect(), this.filters = value.slice(), this.connect()) : this.filters = value.slice(), this;
  }
  setDetune(value) {
    if (this.detune = value, this.source.detune !== void 0)
      return this.isPlaying === !0 && this.source.detune.setTargetAtTime(this.detune, this.context.currentTime, 0.01), this;
  }
  getDetune() {
    return this.detune;
  }
  getFilter() {
    return this.getFilters()[0];
  }
  setFilter(filter) {
    return this.setFilters(filter ? [filter] : []);
  }
  setPlaybackRate(value) {
    if (this.hasPlaybackControl === !1) {
      console.warn("THREE.Audio: this Audio has no playback control.");
      return;
    }
    return this.playbackRate = value, this.isPlaying === !0 && this.source.playbackRate.setTargetAtTime(this.playbackRate, this.context.currentTime, 0.01), this;
  }
  getPlaybackRate() {
    return this.playbackRate;
  }
  onEnded() {
    this.isPlaying = !1;
  }
  getLoop() {
    return this.hasPlaybackControl === !1 ? (console.warn("THREE.Audio: this Audio has no playback control."), !1) : this.loop;
  }
  setLoop(value) {
    if (this.hasPlaybackControl === !1) {
      console.warn("THREE.Audio: this Audio has no playback control.");
      return;
    }
    return this.loop = value, this.isPlaying === !0 && (this.source.loop = this.loop), this;
  }
  setLoopStart(value) {
    return this.loopStart = value, this;
  }
  setLoopEnd(value) {
    return this.loopEnd = value, this;
  }
  getVolume() {
    return this.gain.gain.value;
  }
  setVolume(value) {
    return this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.01), this;
  }
};
var AudioAnalyser = class {
  constructor(audio, fftSize = 2048) {
    this.analyser = audio.context.createAnalyser(), this.analyser.fftSize = fftSize, this.data = new Uint8Array(this.analyser.frequencyBinCount), audio.getOutput().connect(this.analyser);
  }
  getFrequencyData() {
    return this.analyser.getByteFrequencyData(this.data), this.data;
  }
  getAverageFrequency() {
    let value = 0, data = this.getFrequencyData();
    for (let i = 0; i < data.length; i++)
      value += data[i];
    return value / data.length;
  }
}, PropertyMixer = class {
  constructor(binding, typeName, valueSize) {
    this.binding = binding, this.valueSize = valueSize;
    let mixFunction, mixFunctionAdditive, setIdentity;
    switch (typeName) {
      case "quaternion":
        mixFunction = this._slerp, mixFunctionAdditive = this._slerpAdditive, setIdentity = this._setAdditiveIdentityQuaternion, this.buffer = new Float64Array(valueSize * 6), this._workIndex = 5;
        break;
      case "string":
      case "bool":
        mixFunction = this._select, mixFunctionAdditive = this._select, setIdentity = this._setAdditiveIdentityOther, this.buffer = new Array(valueSize * 5);
        break;
      default:
        mixFunction = this._lerp, mixFunctionAdditive = this._lerpAdditive, setIdentity = this._setAdditiveIdentityNumeric, this.buffer = new Float64Array(valueSize * 5);
    }
    this._mixBufferRegion = mixFunction, this._mixBufferRegionAdditive = mixFunctionAdditive, this._setIdentity = setIdentity, this._origIndex = 3, this._addIndex = 4, this.cumulativeWeight = 0, this.cumulativeWeightAdditive = 0, this.useCount = 0, this.referenceCount = 0;
  }
  accumulate(accuIndex, weight) {
    let buffer = this.buffer, stride = this.valueSize, offset = accuIndex * stride + stride, currentWeight = this.cumulativeWeight;
    if (currentWeight === 0) {
      for (let i = 0; i !== stride; ++i)
        buffer[offset + i] = buffer[i];
      currentWeight = weight;
    } else {
      currentWeight += weight;
      let mix = weight / currentWeight;
      this._mixBufferRegion(buffer, offset, 0, mix, stride);
    }
    this.cumulativeWeight = currentWeight;
  }
  accumulateAdditive(weight) {
    let buffer = this.buffer, stride = this.valueSize, offset = stride * this._addIndex;
    this.cumulativeWeightAdditive === 0 && this._setIdentity(), this._mixBufferRegionAdditive(buffer, offset, 0, weight, stride), this.cumulativeWeightAdditive += weight;
  }
  apply(accuIndex) {
    let stride = this.valueSize, buffer = this.buffer, offset = accuIndex * stride + stride, weight = this.cumulativeWeight, weightAdditive = this.cumulativeWeightAdditive, binding = this.binding;
    if (this.cumulativeWeight = 0, this.cumulativeWeightAdditive = 0, weight < 1) {
      let originalValueOffset = stride * this._origIndex;
      this._mixBufferRegion(buffer, offset, originalValueOffset, 1 - weight, stride);
    }
    weightAdditive > 0 && this._mixBufferRegionAdditive(buffer, offset, this._addIndex * stride, 1, stride);
    for (let i = stride, e = stride + stride; i !== e; ++i)
      if (buffer[i] !== buffer[i + stride]) {
        binding.setValue(buffer, offset);
        break;
      }
  }
  saveOriginalState() {
    let binding = this.binding, buffer = this.buffer, stride = this.valueSize, originalValueOffset = stride * this._origIndex;
    binding.getValue(buffer, originalValueOffset);
    for (let i = stride, e = originalValueOffset; i !== e; ++i)
      buffer[i] = buffer[originalValueOffset + i % stride];
    this._setIdentity(), this.cumulativeWeight = 0, this.cumulativeWeightAdditive = 0;
  }
  restoreOriginalState() {
    let originalValueOffset = this.valueSize * 3;
    this.binding.setValue(this.buffer, originalValueOffset);
  }
  _setAdditiveIdentityNumeric() {
    let startIndex = this._addIndex * this.valueSize, endIndex = startIndex + this.valueSize;
    for (let i = startIndex; i < endIndex; i++)
      this.buffer[i] = 0;
  }
  _setAdditiveIdentityQuaternion() {
    this._setAdditiveIdentityNumeric(), this.buffer[this._addIndex * this.valueSize + 3] = 1;
  }
  _setAdditiveIdentityOther() {
    let startIndex = this._origIndex * this.valueSize, targetIndex = this._addIndex * this.valueSize;
    for (let i = 0; i < this.valueSize; i++)
      this.buffer[targetIndex + i] = this.buffer[startIndex + i];
  }
  _select(buffer, dstOffset, srcOffset, t, stride) {
    if (t >= 0.5)
      for (let i = 0; i !== stride; ++i)
        buffer[dstOffset + i] = buffer[srcOffset + i];
  }
  _slerp(buffer, dstOffset, srcOffset, t) {
    Quaternion.slerpFlat(buffer, dstOffset, buffer, dstOffset, buffer, srcOffset, t);
  }
  _slerpAdditive(buffer, dstOffset, srcOffset, t, stride) {
    let workOffset = this._workIndex * stride;
    Quaternion.multiplyQuaternionsFlat(buffer, workOffset, buffer, dstOffset, buffer, srcOffset), Quaternion.slerpFlat(buffer, dstOffset, buffer, dstOffset, buffer, workOffset, t);
  }
  _lerp(buffer, dstOffset, srcOffset, t, stride) {
    let s = 1 - t;
    for (let i = 0; i !== stride; ++i) {
      let j = dstOffset + i;
      buffer[j] = buffer[j] * s + buffer[srcOffset + i] * t;
    }
  }
  _lerpAdditive(buffer, dstOffset, srcOffset, t, stride) {
    for (let i = 0; i !== stride; ++i) {
      let j = dstOffset + i;
      buffer[j] = buffer[j] + buffer[srcOffset + i] * t;
    }
  }
}, _RESERVED_CHARS_RE = "\\[\\]\\.:\\/", _reservedRe = new RegExp("[" + _RESERVED_CHARS_RE + "]", "g"), _wordChar = "[^" + _RESERVED_CHARS_RE + "]", _wordCharOrDot = "[^" + _RESERVED_CHARS_RE.replace("\\.", "") + "]", _directoryRe = /((?:WC+[\/:])*)/.source.replace("WC", _wordChar), _nodeRe = /(WCOD+)?/.source.replace("WCOD", _wordCharOrDot), _objectRe = /(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC", _wordChar), _propertyRe = /\.(WC+)(?:\[(.+)\])?/.source.replace("WC", _wordChar), _trackRe = new RegExp("^" + _directoryRe + _nodeRe + _objectRe + _propertyRe + "$"), _supportedObjectNames = ["material", "materials", "bones"], Composite = class {
  constructor(targetGroup, path, optionalParsedPath) {
    let parsedPath = optionalParsedPath || PropertyBinding.parseTrackName(path);
    this._targetGroup = targetGroup, this._bindings = targetGroup.subscribe_(path, parsedPath);
  }
  getValue(array, offset) {
    this.bind();
    let firstValidIndex = this._targetGroup.nCachedObjects_, binding = this._bindings[firstValidIndex];
    binding !== void 0 && binding.getValue(array, offset);
  }
  setValue(array, offset) {
    let bindings = this._bindings;
    for (let i = this._targetGroup.nCachedObjects_, n = bindings.length; i !== n; ++i)
      bindings[i].setValue(array, offset);
  }
  bind() {
    let bindings = this._bindings;
    for (let i = this._targetGroup.nCachedObjects_, n = bindings.length; i !== n; ++i)
      bindings[i].bind();
  }
  unbind() {
    let bindings = this._bindings;
    for (let i = this._targetGroup.nCachedObjects_, n = bindings.length; i !== n; ++i)
      bindings[i].unbind();
  }
}, PropertyBinding = class {
  constructor(rootNode, path, parsedPath) {
    this.path = path, this.parsedPath = parsedPath || PropertyBinding.parseTrackName(path), this.node = PropertyBinding.findNode(rootNode, this.parsedPath.nodeName) || rootNode, this.rootNode = rootNode, this.getValue = this._getValue_unbound, this.setValue = this._setValue_unbound;
  }
  static create(root, path, parsedPath) {
    return root && root.isAnimationObjectGroup ? new PropertyBinding.Composite(root, path, parsedPath) : new PropertyBinding(root, path, parsedPath);
  }
  static sanitizeNodeName(name) {
    return name.replace(/\s/g, "_").replace(_reservedRe, "");
  }
  static parseTrackName(trackName) {
    let matches = _trackRe.exec(trackName);
    if (!matches)
      throw new Error("PropertyBinding: Cannot parse trackName: " + trackName);
    let results = {
      nodeName: matches[2],
      objectName: matches[3],
      objectIndex: matches[4],
      propertyName: matches[5],
      propertyIndex: matches[6]
    }, lastDot = results.nodeName && results.nodeName.lastIndexOf(".");
    if (lastDot !== void 0 && lastDot !== -1) {
      let objectName = results.nodeName.substring(lastDot + 1);
      _supportedObjectNames.indexOf(objectName) !== -1 && (results.nodeName = results.nodeName.substring(0, lastDot), results.objectName = objectName);
    }
    if (results.propertyName === null || results.propertyName.length === 0)
      throw new Error("PropertyBinding: can not parse propertyName from trackName: " + trackName);
    return results;
  }
  static findNode(root, nodeName) {
    if (!nodeName || nodeName === "" || nodeName === "." || nodeName === -1 || nodeName === root.name || nodeName === root.uuid)
      return root;
    if (root.skeleton) {
      let bone = root.skeleton.getBoneByName(nodeName);
      if (bone !== void 0)
        return bone;
    }
    if (root.children) {
      let searchNodeSubtree = function(children) {
        for (let i = 0; i < children.length; i++) {
          let childNode = children[i];
          if (childNode.name === nodeName || childNode.uuid === nodeName)
            return childNode;
          let result = searchNodeSubtree(childNode.children);
          if (result)
            return result;
        }
        return null;
      }, subTreeNode = searchNodeSubtree(root.children);
      if (subTreeNode)
        return subTreeNode;
    }
    return null;
  }
  _getValue_unavailable() {
  }
  _setValue_unavailable() {
  }
  _getValue_direct(buffer, offset) {
    buffer[offset] = this.node[this.propertyName];
  }
  _getValue_array(buffer, offset) {
    let source = this.resolvedProperty;
    for (let i = 0, n = source.length; i !== n; ++i)
      buffer[offset++] = source[i];
  }
  _getValue_arrayElement(buffer, offset) {
    buffer[offset] = this.resolvedProperty[this.propertyIndex];
  }
  _getValue_toArray(buffer, offset) {
    this.resolvedProperty.toArray(buffer, offset);
  }
  _setValue_direct(buffer, offset) {
    this.targetObject[this.propertyName] = buffer[offset];
  }
  _setValue_direct_setNeedsUpdate(buffer, offset) {
    this.targetObject[this.propertyName] = buffer[offset], this.targetObject.needsUpdate = !0;
  }
  _setValue_direct_setMatrixWorldNeedsUpdate(buffer, offset) {
    this.targetObject[this.propertyName] = buffer[offset], this.targetObject.matrixWorldNeedsUpdate = !0;
  }
  _setValue_array(buffer, offset) {
    let dest = this.resolvedProperty;
    for (let i = 0, n = dest.length; i !== n; ++i)
      dest[i] = buffer[offset++];
  }
  _setValue_array_setNeedsUpdate(buffer, offset) {
    let dest = this.resolvedProperty;
    for (let i = 0, n = dest.length; i !== n; ++i)
      dest[i] = buffer[offset++];
    this.targetObject.needsUpdate = !0;
  }
  _setValue_array_setMatrixWorldNeedsUpdate(buffer, offset) {
    let dest = this.resolvedProperty;
    for (let i = 0, n = dest.length; i !== n; ++i)
      dest[i] = buffer[offset++];
    this.targetObject.matrixWorldNeedsUpdate = !0;
  }
  _setValue_arrayElement(buffer, offset) {
    this.resolvedProperty[this.propertyIndex] = buffer[offset];
  }
  _setValue_arrayElement_setNeedsUpdate(buffer, offset) {
    this.resolvedProperty[this.propertyIndex] = buffer[offset], this.targetObject.needsUpdate = !0;
  }
  _setValue_arrayElement_setMatrixWorldNeedsUpdate(buffer, offset) {
    this.resolvedProperty[this.propertyIndex] = buffer[offset], this.targetObject.matrixWorldNeedsUpdate = !0;
  }
  _setValue_fromArray(buffer, offset) {
    this.resolvedProperty.fromArray(buffer, offset);
  }
  _setValue_fromArray_setNeedsUpdate(buffer, offset) {
    this.resolvedProperty.fromArray(buffer, offset), this.targetObject.needsUpdate = !0;
  }
  _setValue_fromArray_setMatrixWorldNeedsUpdate(buffer, offset) {
    this.resolvedProperty.fromArray(buffer, offset), this.targetObject.matrixWorldNeedsUpdate = !0;
  }
  _getValue_unbound(targetArray, offset) {
    this.bind(), this.getValue(targetArray, offset);
  }
  _setValue_unbound(sourceArray, offset) {
    this.bind(), this.setValue(sourceArray, offset);
  }
  bind() {
    let targetObject = this.node, parsedPath = this.parsedPath, objectName = parsedPath.objectName, propertyName = parsedPath.propertyName, propertyIndex = parsedPath.propertyIndex;
    if (targetObject || (targetObject = PropertyBinding.findNode(this.rootNode, parsedPath.nodeName) || this.rootNode, this.node = targetObject), this.getValue = this._getValue_unavailable, this.setValue = this._setValue_unavailable, !targetObject) {
      console.error("THREE.PropertyBinding: Trying to update node for track: " + this.path + " but it wasn't found.");
      return;
    }
    if (objectName) {
      let objectIndex = parsedPath.objectIndex;
      switch (objectName) {
        case "materials":
          if (!targetObject.material) {
            console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.", this);
            return;
          }
          if (!targetObject.material.materials) {
            console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.", this);
            return;
          }
          targetObject = targetObject.material.materials;
          break;
        case "bones":
          if (!targetObject.skeleton) {
            console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.", this);
            return;
          }
          targetObject = targetObject.skeleton.bones;
          for (let i = 0; i < targetObject.length; i++)
            if (targetObject[i].name === objectIndex) {
              objectIndex = i;
              break;
            }
          break;
        default:
          if (targetObject[objectName] === void 0) {
            console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.", this);
            return;
          }
          targetObject = targetObject[objectName];
      }
      if (objectIndex !== void 0) {
        if (targetObject[objectIndex] === void 0) {
          console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.", this, targetObject);
          return;
        }
        targetObject = targetObject[objectIndex];
      }
    }
    let nodeProperty = targetObject[propertyName];
    if (nodeProperty === void 0) {
      let nodeName = parsedPath.nodeName;
      console.error("THREE.PropertyBinding: Trying to update property for track: " + nodeName + "." + propertyName + " but it wasn't found.", targetObject);
      return;
    }
    let versioning = this.Versioning.None;
    this.targetObject = targetObject, targetObject.needsUpdate !== void 0 ? versioning = this.Versioning.NeedsUpdate : targetObject.matrixWorldNeedsUpdate !== void 0 && (versioning = this.Versioning.MatrixWorldNeedsUpdate);
    let bindingType = this.BindingType.Direct;
    if (propertyIndex !== void 0) {
      if (propertyName === "morphTargetInfluences") {
        if (!targetObject.geometry) {
          console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.", this);
          return;
        }
        if (targetObject.geometry.isBufferGeometry) {
          if (!targetObject.geometry.morphAttributes) {
            console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.", this);
            return;
          }
          targetObject.morphTargetDictionary[propertyIndex] !== void 0 && (propertyIndex = targetObject.morphTargetDictionary[propertyIndex]);
        } else {
          console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences on THREE.Geometry. Use THREE.BufferGeometry instead.", this);
          return;
        }
      }
      bindingType = this.BindingType.ArrayElement, this.resolvedProperty = nodeProperty, this.propertyIndex = propertyIndex;
    } else
      nodeProperty.fromArray !== void 0 && nodeProperty.toArray !== void 0 ? (bindingType = this.BindingType.HasFromToArray, this.resolvedProperty = nodeProperty) : Array.isArray(nodeProperty) ? (bindingType = this.BindingType.EntireArray, this.resolvedProperty = nodeProperty) : this.propertyName = propertyName;
    this.getValue = this.GetterByBindingType[bindingType], this.setValue = this.SetterByBindingTypeAndVersioning[bindingType][versioning];
  }
  unbind() {
    this.node = null, this.getValue = this._getValue_unbound, this.setValue = this._setValue_unbound;
  }
};
PropertyBinding.Composite = Composite;
PropertyBinding.prototype.BindingType = {
  Direct: 0,
  EntireArray: 1,
  ArrayElement: 2,
  HasFromToArray: 3
};
PropertyBinding.prototype.Versioning = {
  None: 0,
  NeedsUpdate: 1,
  MatrixWorldNeedsUpdate: 2
};
PropertyBinding.prototype.GetterByBindingType = [
  PropertyBinding.prototype._getValue_direct,
  PropertyBinding.prototype._getValue_array,
  PropertyBinding.prototype._getValue_arrayElement,
  PropertyBinding.prototype._getValue_toArray
];
PropertyBinding.prototype.SetterByBindingTypeAndVersioning = [
  [
    PropertyBinding.prototype._setValue_direct,
    PropertyBinding.prototype._setValue_direct_setNeedsUpdate,
    PropertyBinding.prototype._setValue_direct_setMatrixWorldNeedsUpdate
  ],
  [
    PropertyBinding.prototype._setValue_array,
    PropertyBinding.prototype._setValue_array_setNeedsUpdate,
    PropertyBinding.prototype._setValue_array_setMatrixWorldNeedsUpdate
  ],
  [
    PropertyBinding.prototype._setValue_arrayElement,
    PropertyBinding.prototype._setValue_arrayElement_setNeedsUpdate,
    PropertyBinding.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate
  ],
  [
    PropertyBinding.prototype._setValue_fromArray,
    PropertyBinding.prototype._setValue_fromArray_setNeedsUpdate,
    PropertyBinding.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate
  ]
];
var AnimationObjectGroup = class {
  constructor() {
    this.uuid = generateUUID(), this._objects = Array.prototype.slice.call(arguments), this.nCachedObjects_ = 0;
    let indices = {};
    this._indicesByUUID = indices;
    for (let i = 0, n = arguments.length; i !== n; ++i)
      indices[arguments[i].uuid] = i;
    this._paths = [], this._parsedPaths = [], this._bindings = [], this._bindingsIndicesByPath = {};
    let scope = this;
    this.stats = {
      objects: {
        get total() {
          return scope._objects.length;
        },
        get inUse() {
          return this.total - scope.nCachedObjects_;
        }
      },
      get bindingsPerObject() {
        return scope._bindings.length;
      }
    };
  }
  add() {
    let objects = this._objects, indicesByUUID = this._indicesByUUID, paths = this._paths, parsedPaths = this._parsedPaths, bindings = this._bindings, nBindings = bindings.length, knownObject, nObjects = objects.length, nCachedObjects = this.nCachedObjects_;
    for (let i = 0, n = arguments.length; i !== n; ++i) {
      let object = arguments[i], uuid = object.uuid, index = indicesByUUID[uuid];
      if (index === void 0) {
        index = nObjects++, indicesByUUID[uuid] = index, objects.push(object);
        for (let j = 0, m = nBindings; j !== m; ++j)
          bindings[j].push(new PropertyBinding(object, paths[j], parsedPaths[j]));
      } else if (index < nCachedObjects) {
        knownObject = objects[index];
        let firstActiveIndex = --nCachedObjects, lastCachedObject = objects[firstActiveIndex];
        indicesByUUID[lastCachedObject.uuid] = index, objects[index] = lastCachedObject, indicesByUUID[uuid] = firstActiveIndex, objects[firstActiveIndex] = object;
        for (let j = 0, m = nBindings; j !== m; ++j) {
          let bindingsForPath = bindings[j], lastCached = bindingsForPath[firstActiveIndex], binding = bindingsForPath[index];
          bindingsForPath[index] = lastCached, binding === void 0 && (binding = new PropertyBinding(object, paths[j], parsedPaths[j])), bindingsForPath[firstActiveIndex] = binding;
        }
      } else
        objects[index] !== knownObject && console.error("THREE.AnimationObjectGroup: Different objects with the same UUID detected. Clean the caches or recreate your infrastructure when reloading scenes.");
    }
    this.nCachedObjects_ = nCachedObjects;
  }
  remove() {
    let objects = this._objects, indicesByUUID = this._indicesByUUID, bindings = this._bindings, nBindings = bindings.length, nCachedObjects = this.nCachedObjects_;
    for (let i = 0, n = arguments.length; i !== n; ++i) {
      let object = arguments[i], uuid = object.uuid, index = indicesByUUID[uuid];
      if (index !== void 0 && index >= nCachedObjects) {
        let lastCachedIndex = nCachedObjects++, firstActiveObject = objects[lastCachedIndex];
        indicesByUUID[firstActiveObject.uuid] = index, objects[index] = firstActiveObject, indicesByUUID[uuid] = lastCachedIndex, objects[lastCachedIndex] = object;
        for (let j = 0, m = nBindings; j !== m; ++j) {
          let bindingsForPath = bindings[j], firstActive = bindingsForPath[lastCachedIndex], binding = bindingsForPath[index];
          bindingsForPath[index] = firstActive, bindingsForPath[lastCachedIndex] = binding;
        }
      }
    }
    this.nCachedObjects_ = nCachedObjects;
  }
  uncache() {
    let objects = this._objects, indicesByUUID = this._indicesByUUID, bindings = this._bindings, nBindings = bindings.length, nCachedObjects = this.nCachedObjects_, nObjects = objects.length;
    for (let i = 0, n = arguments.length; i !== n; ++i) {
      let object = arguments[i], uuid = object.uuid, index = indicesByUUID[uuid];
      if (index !== void 0)
        if (delete indicesByUUID[uuid], index < nCachedObjects) {
          let firstActiveIndex = --nCachedObjects, lastCachedObject = objects[firstActiveIndex], lastIndex = --nObjects, lastObject = objects[lastIndex];
          indicesByUUID[lastCachedObject.uuid] = index, objects[index] = lastCachedObject, indicesByUUID[lastObject.uuid] = firstActiveIndex, objects[firstActiveIndex] = lastObject, objects.pop();
          for (let j = 0, m = nBindings; j !== m; ++j) {
            let bindingsForPath = bindings[j], lastCached = bindingsForPath[firstActiveIndex], last = bindingsForPath[lastIndex];
            bindingsForPath[index] = lastCached, bindingsForPath[firstActiveIndex] = last, bindingsForPath.pop();
          }
        } else {
          let lastIndex = --nObjects, lastObject = objects[lastIndex];
          lastIndex > 0 && (indicesByUUID[lastObject.uuid] = index), objects[index] = lastObject, objects.pop();
          for (let j = 0, m = nBindings; j !== m; ++j) {
            let bindingsForPath = bindings[j];
            bindingsForPath[index] = bindingsForPath[lastIndex], bindingsForPath.pop();
          }
        }
    }
    this.nCachedObjects_ = nCachedObjects;
  }
  subscribe_(path, parsedPath) {
    let indicesByPath = this._bindingsIndicesByPath, index = indicesByPath[path], bindings = this._bindings;
    if (index !== void 0)
      return bindings[index];
    let paths = this._paths, parsedPaths = this._parsedPaths, objects = this._objects, nObjects = objects.length, nCachedObjects = this.nCachedObjects_, bindingsForPath = new Array(nObjects);
    index = bindings.length, indicesByPath[path] = index, paths.push(path), parsedPaths.push(parsedPath), bindings.push(bindingsForPath);
    for (let i = nCachedObjects, n = objects.length; i !== n; ++i) {
      let object = objects[i];
      bindingsForPath[i] = new PropertyBinding(object, path, parsedPath);
    }
    return bindingsForPath;
  }
  unsubscribe_(path) {
    let indicesByPath = this._bindingsIndicesByPath, index = indicesByPath[path];
    if (index !== void 0) {
      let paths = this._paths, parsedPaths = this._parsedPaths, bindings = this._bindings, lastBindingsIndex = bindings.length - 1, lastBindings = bindings[lastBindingsIndex], lastBindingsPath = path[lastBindingsIndex];
      indicesByPath[lastBindingsPath] = index, bindings[index] = lastBindings, bindings.pop(), parsedPaths[index] = parsedPaths[lastBindingsIndex], parsedPaths.pop(), paths[index] = paths[lastBindingsIndex], paths.pop();
    }
  }
};
AnimationObjectGroup.prototype.isAnimationObjectGroup = !0;
var AnimationAction = class {
  constructor(mixer, clip, localRoot = null, blendMode = clip.blendMode) {
    this._mixer = mixer, this._clip = clip, this._localRoot = localRoot, this.blendMode = blendMode;
    let tracks = clip.tracks, nTracks = tracks.length, interpolants = new Array(nTracks), interpolantSettings = {
      endingStart: ZeroCurvatureEnding,
      endingEnd: ZeroCurvatureEnding
    };
    for (let i = 0; i !== nTracks; ++i) {
      let interpolant = tracks[i].createInterpolant(null);
      interpolants[i] = interpolant, interpolant.settings = interpolantSettings;
    }
    this._interpolantSettings = interpolantSettings, this._interpolants = interpolants, this._propertyBindings = new Array(nTracks), this._cacheIndex = null, this._byClipCacheIndex = null, this._timeScaleInterpolant = null, this._weightInterpolant = null, this.loop = LoopRepeat, this._loopCount = -1, this._startTime = null, this.time = 0, this.timeScale = 1, this._effectiveTimeScale = 1, this.weight = 1, this._effectiveWeight = 1, this.repetitions = Infinity, this.paused = !1, this.enabled = !0, this.clampWhenFinished = !1, this.zeroSlopeAtStart = !0, this.zeroSlopeAtEnd = !0;
  }
  play() {
    return this._mixer._activateAction(this), this;
  }
  stop() {
    return this._mixer._deactivateAction(this), this.reset();
  }
  reset() {
    return this.paused = !1, this.enabled = !0, this.time = 0, this._loopCount = -1, this._startTime = null, this.stopFading().stopWarping();
  }
  isRunning() {
    return this.enabled && !this.paused && this.timeScale !== 0 && this._startTime === null && this._mixer._isActiveAction(this);
  }
  isScheduled() {
    return this._mixer._isActiveAction(this);
  }
  startAt(time) {
    return this._startTime = time, this;
  }
  setLoop(mode, repetitions) {
    return this.loop = mode, this.repetitions = repetitions, this;
  }
  setEffectiveWeight(weight) {
    return this.weight = weight, this._effectiveWeight = this.enabled ? weight : 0, this.stopFading();
  }
  getEffectiveWeight() {
    return this._effectiveWeight;
  }
  fadeIn(duration) {
    return this._scheduleFading(duration, 0, 1);
  }
  fadeOut(duration) {
    return this._scheduleFading(duration, 1, 0);
  }
  crossFadeFrom(fadeOutAction, duration, warp) {
    if (fadeOutAction.fadeOut(duration), this.fadeIn(duration), warp) {
      let fadeInDuration = this._clip.duration, fadeOutDuration = fadeOutAction._clip.duration, startEndRatio = fadeOutDuration / fadeInDuration, endStartRatio = fadeInDuration / fadeOutDuration;
      fadeOutAction.warp(1, startEndRatio, duration), this.warp(endStartRatio, 1, duration);
    }
    return this;
  }
  crossFadeTo(fadeInAction, duration, warp) {
    return fadeInAction.crossFadeFrom(this, duration, warp);
  }
  stopFading() {
    let weightInterpolant = this._weightInterpolant;
    return weightInterpolant !== null && (this._weightInterpolant = null, this._mixer._takeBackControlInterpolant(weightInterpolant)), this;
  }
  setEffectiveTimeScale(timeScale) {
    return this.timeScale = timeScale, this._effectiveTimeScale = this.paused ? 0 : timeScale, this.stopWarping();
  }
  getEffectiveTimeScale() {
    return this._effectiveTimeScale;
  }
  setDuration(duration) {
    return this.timeScale = this._clip.duration / duration, this.stopWarping();
  }
  syncWith(action) {
    return this.time = action.time, this.timeScale = action.timeScale, this.stopWarping();
  }
  halt(duration) {
    return this.warp(this._effectiveTimeScale, 0, duration);
  }
  warp(startTimeScale, endTimeScale, duration) {
    let mixer = this._mixer, now = mixer.time, timeScale = this.timeScale, interpolant = this._timeScaleInterpolant;
    interpolant === null && (interpolant = mixer._lendControlInterpolant(), this._timeScaleInterpolant = interpolant);
    let times = interpolant.parameterPositions, values = interpolant.sampleValues;
    return times[0] = now, times[1] = now + duration, values[0] = startTimeScale / timeScale, values[1] = endTimeScale / timeScale, this;
  }
  stopWarping() {
    let timeScaleInterpolant = this._timeScaleInterpolant;
    return timeScaleInterpolant !== null && (this._timeScaleInterpolant = null, this._mixer._takeBackControlInterpolant(timeScaleInterpolant)), this;
  }
  getMixer() {
    return this._mixer;
  }
  getClip() {
    return this._clip;
  }
  getRoot() {
    return this._localRoot || this._mixer._root;
  }
  _update(time, deltaTime, timeDirection, accuIndex) {
    if (!this.enabled) {
      this._updateWeight(time);
      return;
    }
    let startTime = this._startTime;
    if (startTime !== null) {
      let timeRunning = (time - startTime) * timeDirection;
      if (timeRunning < 0 || timeDirection === 0)
        return;
      this._startTime = null, deltaTime = timeDirection * timeRunning;
    }
    deltaTime *= this._updateTimeScale(time);
    let clipTime = this._updateTime(deltaTime), weight = this._updateWeight(time);
    if (weight > 0) {
      let interpolants = this._interpolants, propertyMixers = this._propertyBindings;
      switch (this.blendMode) {
        case AdditiveAnimationBlendMode:
          for (let j = 0, m = interpolants.length; j !== m; ++j)
            interpolants[j].evaluate(clipTime), propertyMixers[j].accumulateAdditive(weight);
          break;
        case NormalAnimationBlendMode:
        default:
          for (let j = 0, m = interpolants.length; j !== m; ++j)
            interpolants[j].evaluate(clipTime), propertyMixers[j].accumulate(accuIndex, weight);
      }
    }
  }
  _updateWeight(time) {
    let weight = 0;
    if (this.enabled) {
      weight = this.weight;
      let interpolant = this._weightInterpolant;
      if (interpolant !== null) {
        let interpolantValue = interpolant.evaluate(time)[0];
        weight *= interpolantValue, time > interpolant.parameterPositions[1] && (this.stopFading(), interpolantValue === 0 && (this.enabled = !1));
      }
    }
    return this._effectiveWeight = weight, weight;
  }
  _updateTimeScale(time) {
    let timeScale = 0;
    if (!this.paused) {
      timeScale = this.timeScale;
      let interpolant = this._timeScaleInterpolant;
      interpolant !== null && (timeScale *= interpolant.evaluate(time)[0], time > interpolant.parameterPositions[1] && (this.stopWarping(), timeScale === 0 ? this.paused = !0 : this.timeScale = timeScale));
    }
    return this._effectiveTimeScale = timeScale, timeScale;
  }
  _updateTime(deltaTime) {
    let duration = this._clip.duration, loop = this.loop, time = this.time + deltaTime, loopCount = this._loopCount, pingPong = loop === LoopPingPong;
    if (deltaTime === 0)
      return loopCount === -1 ? time : pingPong && (loopCount & 1) == 1 ? duration - time : time;
    if (loop === LoopOnce) {
      loopCount === -1 && (this._loopCount = 0, this._setEndings(!0, !0, !1));
      handle_stop: {
        if (time >= duration)
          time = duration;
        else if (time < 0)
          time = 0;
        else {
          this.time = time;
          break handle_stop;
        }
        this.clampWhenFinished ? this.paused = !0 : this.enabled = !1, this.time = time, this._mixer.dispatchEvent({
          type: "finished",
          action: this,
          direction: deltaTime < 0 ? -1 : 1
        });
      }
    } else {
      if (loopCount === -1 && (deltaTime >= 0 ? (loopCount = 0, this._setEndings(!0, this.repetitions === 0, pingPong)) : this._setEndings(this.repetitions === 0, !0, pingPong)), time >= duration || time < 0) {
        let loopDelta = Math.floor(time / duration);
        time -= duration * loopDelta, loopCount += Math.abs(loopDelta);
        let pending = this.repetitions - loopCount;
        if (pending <= 0)
          this.clampWhenFinished ? this.paused = !0 : this.enabled = !1, time = deltaTime > 0 ? duration : 0, this.time = time, this._mixer.dispatchEvent({
            type: "finished",
            action: this,
            direction: deltaTime > 0 ? 1 : -1
          });
        else {
          if (pending === 1) {
            let atStart = deltaTime < 0;
            this._setEndings(atStart, !atStart, pingPong);
          } else
            this._setEndings(!1, !1, pingPong);
          this._loopCount = loopCount, this.time = time, this._mixer.dispatchEvent({
            type: "loop",
            action: this,
            loopDelta
          });
        }
      } else
        this.time = time;
      if (pingPong && (loopCount & 1) == 1)
        return duration - time;
    }
    return time;
  }
  _setEndings(atStart, atEnd, pingPong) {
    let settings = this._interpolantSettings;
    pingPong ? (settings.endingStart = ZeroSlopeEnding, settings.endingEnd = ZeroSlopeEnding) : (atStart ? settings.endingStart = this.zeroSlopeAtStart ? ZeroSlopeEnding : ZeroCurvatureEnding : settings.endingStart = WrapAroundEnding, atEnd ? settings.endingEnd = this.zeroSlopeAtEnd ? ZeroSlopeEnding : ZeroCurvatureEnding : settings.endingEnd = WrapAroundEnding);
  }
  _scheduleFading(duration, weightNow, weightThen) {
    let mixer = this._mixer, now = mixer.time, interpolant = this._weightInterpolant;
    interpolant === null && (interpolant = mixer._lendControlInterpolant(), this._weightInterpolant = interpolant);
    let times = interpolant.parameterPositions, values = interpolant.sampleValues;
    return times[0] = now, values[0] = weightNow, times[1] = now + duration, values[1] = weightThen, this;
  }
}, AnimationMixer = class extends EventDispatcher {
  constructor(root) {
    super();
    this._root = root, this._initMemoryManager(), this._accuIndex = 0, this.time = 0, this.timeScale = 1;
  }
  _bindAction(action, prototypeAction) {
    let root = action._localRoot || this._root, tracks = action._clip.tracks, nTracks = tracks.length, bindings = action._propertyBindings, interpolants = action._interpolants, rootUuid = root.uuid, bindingsByRoot = this._bindingsByRootAndName, bindingsByName = bindingsByRoot[rootUuid];
    bindingsByName === void 0 && (bindingsByName = {}, bindingsByRoot[rootUuid] = bindingsByName);
    for (let i = 0; i !== nTracks; ++i) {
      let track = tracks[i], trackName = track.name, binding = bindingsByName[trackName];
      if (binding !== void 0)
        bindings[i] = binding;
      else {
        if (binding = bindings[i], binding !== void 0) {
          binding._cacheIndex === null && (++binding.referenceCount, this._addInactiveBinding(binding, rootUuid, trackName));
          continue;
        }
        let path = prototypeAction && prototypeAction._propertyBindings[i].binding.parsedPath;
        binding = new PropertyMixer(PropertyBinding.create(root, trackName, path), track.ValueTypeName, track.getValueSize()), ++binding.referenceCount, this._addInactiveBinding(binding, rootUuid, trackName), bindings[i] = binding;
      }
      interpolants[i].resultBuffer = binding.buffer;
    }
  }
  _activateAction(action) {
    if (!this._isActiveAction(action)) {
      if (action._cacheIndex === null) {
        let rootUuid = (action._localRoot || this._root).uuid, clipUuid = action._clip.uuid, actionsForClip = this._actionsByClip[clipUuid];
        this._bindAction(action, actionsForClip && actionsForClip.knownActions[0]), this._addInactiveAction(action, clipUuid, rootUuid);
      }
      let bindings = action._propertyBindings;
      for (let i = 0, n = bindings.length; i !== n; ++i) {
        let binding = bindings[i];
        binding.useCount++ == 0 && (this._lendBinding(binding), binding.saveOriginalState());
      }
      this._lendAction(action);
    }
  }
  _deactivateAction(action) {
    if (this._isActiveAction(action)) {
      let bindings = action._propertyBindings;
      for (let i = 0, n = bindings.length; i !== n; ++i) {
        let binding = bindings[i];
        --binding.useCount == 0 && (binding.restoreOriginalState(), this._takeBackBinding(binding));
      }
      this._takeBackAction(action);
    }
  }
  _initMemoryManager() {
    this._actions = [], this._nActiveActions = 0, this._actionsByClip = {}, this._bindings = [], this._nActiveBindings = 0, this._bindingsByRootAndName = {}, this._controlInterpolants = [], this._nActiveControlInterpolants = 0;
    let scope = this;
    this.stats = {
      actions: {
        get total() {
          return scope._actions.length;
        },
        get inUse() {
          return scope._nActiveActions;
        }
      },
      bindings: {
        get total() {
          return scope._bindings.length;
        },
        get inUse() {
          return scope._nActiveBindings;
        }
      },
      controlInterpolants: {
        get total() {
          return scope._controlInterpolants.length;
        },
        get inUse() {
          return scope._nActiveControlInterpolants;
        }
      }
    };
  }
  _isActiveAction(action) {
    let index = action._cacheIndex;
    return index !== null && index < this._nActiveActions;
  }
  _addInactiveAction(action, clipUuid, rootUuid) {
    let actions = this._actions, actionsByClip = this._actionsByClip, actionsForClip = actionsByClip[clipUuid];
    if (actionsForClip === void 0)
      actionsForClip = {
        knownActions: [action],
        actionByRoot: {}
      }, action._byClipCacheIndex = 0, actionsByClip[clipUuid] = actionsForClip;
    else {
      let knownActions = actionsForClip.knownActions;
      action._byClipCacheIndex = knownActions.length, knownActions.push(action);
    }
    action._cacheIndex = actions.length, actions.push(action), actionsForClip.actionByRoot[rootUuid] = action;
  }
  _removeInactiveAction(action) {
    let actions = this._actions, lastInactiveAction = actions[actions.length - 1], cacheIndex = action._cacheIndex;
    lastInactiveAction._cacheIndex = cacheIndex, actions[cacheIndex] = lastInactiveAction, actions.pop(), action._cacheIndex = null;
    let clipUuid = action._clip.uuid, actionsByClip = this._actionsByClip, actionsForClip = actionsByClip[clipUuid], knownActionsForClip = actionsForClip.knownActions, lastKnownAction = knownActionsForClip[knownActionsForClip.length - 1], byClipCacheIndex = action._byClipCacheIndex;
    lastKnownAction._byClipCacheIndex = byClipCacheIndex, knownActionsForClip[byClipCacheIndex] = lastKnownAction, knownActionsForClip.pop(), action._byClipCacheIndex = null;
    let actionByRoot = actionsForClip.actionByRoot, rootUuid = (action._localRoot || this._root).uuid;
    delete actionByRoot[rootUuid], knownActionsForClip.length === 0 && delete actionsByClip[clipUuid], this._removeInactiveBindingsForAction(action);
  }
  _removeInactiveBindingsForAction(action) {
    let bindings = action._propertyBindings;
    for (let i = 0, n = bindings.length; i !== n; ++i) {
      let binding = bindings[i];
      --binding.referenceCount == 0 && this._removeInactiveBinding(binding);
    }
  }
  _lendAction(action) {
    let actions = this._actions, prevIndex = action._cacheIndex, lastActiveIndex = this._nActiveActions++, firstInactiveAction = actions[lastActiveIndex];
    action._cacheIndex = lastActiveIndex, actions[lastActiveIndex] = action, firstInactiveAction._cacheIndex = prevIndex, actions[prevIndex] = firstInactiveAction;
  }
  _takeBackAction(action) {
    let actions = this._actions, prevIndex = action._cacheIndex, firstInactiveIndex = --this._nActiveActions, lastActiveAction = actions[firstInactiveIndex];
    action._cacheIndex = firstInactiveIndex, actions[firstInactiveIndex] = action, lastActiveAction._cacheIndex = prevIndex, actions[prevIndex] = lastActiveAction;
  }
  _addInactiveBinding(binding, rootUuid, trackName) {
    let bindingsByRoot = this._bindingsByRootAndName, bindings = this._bindings, bindingByName = bindingsByRoot[rootUuid];
    bindingByName === void 0 && (bindingByName = {}, bindingsByRoot[rootUuid] = bindingByName), bindingByName[trackName] = binding, binding._cacheIndex = bindings.length, bindings.push(binding);
  }
  _removeInactiveBinding(binding) {
    let bindings = this._bindings, propBinding = binding.binding, rootUuid = propBinding.rootNode.uuid, trackName = propBinding.path, bindingsByRoot = this._bindingsByRootAndName, bindingByName = bindingsByRoot[rootUuid], lastInactiveBinding = bindings[bindings.length - 1], cacheIndex = binding._cacheIndex;
    lastInactiveBinding._cacheIndex = cacheIndex, bindings[cacheIndex] = lastInactiveBinding, bindings.pop(), delete bindingByName[trackName], Object.keys(bindingByName).length === 0 && delete bindingsByRoot[rootUuid];
  }
  _lendBinding(binding) {
    let bindings = this._bindings, prevIndex = binding._cacheIndex, lastActiveIndex = this._nActiveBindings++, firstInactiveBinding = bindings[lastActiveIndex];
    binding._cacheIndex = lastActiveIndex, bindings[lastActiveIndex] = binding, firstInactiveBinding._cacheIndex = prevIndex, bindings[prevIndex] = firstInactiveBinding;
  }
  _takeBackBinding(binding) {
    let bindings = this._bindings, prevIndex = binding._cacheIndex, firstInactiveIndex = --this._nActiveBindings, lastActiveBinding = bindings[firstInactiveIndex];
    binding._cacheIndex = firstInactiveIndex, bindings[firstInactiveIndex] = binding, lastActiveBinding._cacheIndex = prevIndex, bindings[prevIndex] = lastActiveBinding;
  }
  _lendControlInterpolant() {
    let interpolants = this._controlInterpolants, lastActiveIndex = this._nActiveControlInterpolants++, interpolant = interpolants[lastActiveIndex];
    return interpolant === void 0 && (interpolant = new LinearInterpolant(new Float32Array(2), new Float32Array(2), 1, this._controlInterpolantsResultBuffer), interpolant.__cacheIndex = lastActiveIndex, interpolants[lastActiveIndex] = interpolant), interpolant;
  }
  _takeBackControlInterpolant(interpolant) {
    let interpolants = this._controlInterpolants, prevIndex = interpolant.__cacheIndex, firstInactiveIndex = --this._nActiveControlInterpolants, lastActiveInterpolant = interpolants[firstInactiveIndex];
    interpolant.__cacheIndex = firstInactiveIndex, interpolants[firstInactiveIndex] = interpolant, lastActiveInterpolant.__cacheIndex = prevIndex, interpolants[prevIndex] = lastActiveInterpolant;
  }
  clipAction(clip, optionalRoot, blendMode) {
    let root = optionalRoot || this._root, rootUuid = root.uuid, clipObject = typeof clip == "string" ? AnimationClip.findByName(root, clip) : clip, clipUuid = clipObject !== null ? clipObject.uuid : clip, actionsForClip = this._actionsByClip[clipUuid], prototypeAction = null;
    if (blendMode === void 0 && (clipObject !== null ? blendMode = clipObject.blendMode : blendMode = NormalAnimationBlendMode), actionsForClip !== void 0) {
      let existingAction = actionsForClip.actionByRoot[rootUuid];
      if (existingAction !== void 0 && existingAction.blendMode === blendMode)
        return existingAction;
      prototypeAction = actionsForClip.knownActions[0], clipObject === null && (clipObject = prototypeAction._clip);
    }
    if (clipObject === null)
      return null;
    let newAction = new AnimationAction(this, clipObject, optionalRoot, blendMode);
    return this._bindAction(newAction, prototypeAction), this._addInactiveAction(newAction, clipUuid, rootUuid), newAction;
  }
  existingAction(clip, optionalRoot) {
    let root = optionalRoot || this._root, rootUuid = root.uuid, clipObject = typeof clip == "string" ? AnimationClip.findByName(root, clip) : clip, clipUuid = clipObject ? clipObject.uuid : clip, actionsForClip = this._actionsByClip[clipUuid];
    return actionsForClip !== void 0 && actionsForClip.actionByRoot[rootUuid] || null;
  }
  stopAllAction() {
    let actions = this._actions, nActions = this._nActiveActions;
    for (let i = nActions - 1; i >= 0; --i)
      actions[i].stop();
    return this;
  }
  update(deltaTime) {
    deltaTime *= this.timeScale;
    let actions = this._actions, nActions = this._nActiveActions, time = this.time += deltaTime, timeDirection = Math.sign(deltaTime), accuIndex = this._accuIndex ^= 1;
    for (let i = 0; i !== nActions; ++i)
      actions[i]._update(time, deltaTime, timeDirection, accuIndex);
    let bindings = this._bindings, nBindings = this._nActiveBindings;
    for (let i = 0; i !== nBindings; ++i)
      bindings[i].apply(accuIndex);
    return this;
  }
  setTime(timeInSeconds) {
    this.time = 0;
    for (let i = 0; i < this._actions.length; i++)
      this._actions[i].time = 0;
    return this.update(timeInSeconds);
  }
  getRoot() {
    return this._root;
  }
  uncacheClip(clip) {
    let actions = this._actions, clipUuid = clip.uuid, actionsByClip = this._actionsByClip, actionsForClip = actionsByClip[clipUuid];
    if (actionsForClip !== void 0) {
      let actionsToRemove = actionsForClip.knownActions;
      for (let i = 0, n = actionsToRemove.length; i !== n; ++i) {
        let action = actionsToRemove[i];
        this._deactivateAction(action);
        let cacheIndex = action._cacheIndex, lastInactiveAction = actions[actions.length - 1];
        action._cacheIndex = null, action._byClipCacheIndex = null, lastInactiveAction._cacheIndex = cacheIndex, actions[cacheIndex] = lastInactiveAction, actions.pop(), this._removeInactiveBindingsForAction(action);
      }
      delete actionsByClip[clipUuid];
    }
  }
  uncacheRoot(root) {
    let rootUuid = root.uuid, actionsByClip = this._actionsByClip;
    for (let clipUuid in actionsByClip) {
      let actionByRoot = actionsByClip[clipUuid].actionByRoot, action = actionByRoot[rootUuid];
      action !== void 0 && (this._deactivateAction(action), this._removeInactiveAction(action));
    }
    let bindingsByRoot = this._bindingsByRootAndName, bindingByName = bindingsByRoot[rootUuid];
    if (bindingByName !== void 0)
      for (let trackName in bindingByName) {
        let binding = bindingByName[trackName];
        binding.restoreOriginalState(), this._removeInactiveBinding(binding);
      }
  }
  uncacheAction(clip, optionalRoot) {
    let action = this.existingAction(clip, optionalRoot);
    action !== null && (this._deactivateAction(action), this._removeInactiveAction(action));
  }
};
AnimationMixer.prototype._controlInterpolantsResultBuffer = new Float32Array(1);
var Uniform = class {
  constructor(value) {
    typeof value == "string" && (console.warn("THREE.Uniform: Type parameter is no longer needed."), value = arguments[1]), this.value = value;
  }
  clone() {
    return new Uniform(this.value.clone === void 0 ? this.value : this.value.clone());
  }
}, InstancedInterleavedBuffer = class extends InterleavedBuffer {
  constructor(array, stride, meshPerAttribute = 1) {
    super(array, stride);
    this.meshPerAttribute = meshPerAttribute || 1;
  }
  copy(source) {
    return super.copy(source), this.meshPerAttribute = source.meshPerAttribute, this;
  }
  clone(data) {
    let ib = super.clone(data);
    return ib.meshPerAttribute = this.meshPerAttribute, ib;
  }
  toJSON(data) {
    let json = super.toJSON(data);
    return json.isInstancedInterleavedBuffer = !0, json.meshPerAttribute = this.meshPerAttribute, json;
  }
};
InstancedInterleavedBuffer.prototype.isInstancedInterleavedBuffer = !0;
var GLBufferAttribute = class {
  constructor(buffer, type, itemSize, elementSize, count) {
    this.buffer = buffer, this.type = type, this.itemSize = itemSize, this.elementSize = elementSize, this.count = count, this.version = 0;
  }
  set needsUpdate(value) {
    value === !0 && this.version++;
  }
  setBuffer(buffer) {
    return this.buffer = buffer, this;
  }
  setType(type, elementSize) {
    return this.type = type, this.elementSize = elementSize, this;
  }
  setItemSize(itemSize) {
    return this.itemSize = itemSize, this;
  }
  setCount(count) {
    return this.count = count, this;
  }
};
GLBufferAttribute.prototype.isGLBufferAttribute = !0;
var _vector$4 = /* @__PURE__ */ new Vector2(), Box2 = class {
  constructor(min = new Vector2(Infinity, Infinity), max = new Vector2(-Infinity, -Infinity)) {
    this.min = min, this.max = max;
  }
  set(min, max) {
    return this.min.copy(min), this.max.copy(max), this;
  }
  setFromPoints(points) {
    this.makeEmpty();
    for (let i = 0, il = points.length; i < il; i++)
      this.expandByPoint(points[i]);
    return this;
  }
  setFromCenterAndSize(center, size) {
    let halfSize = _vector$4.copy(size).multiplyScalar(0.5);
    return this.min.copy(center).sub(halfSize), this.max.copy(center).add(halfSize), this;
  }
  clone() {
    return new this.constructor().copy(this);
  }
  copy(box) {
    return this.min.copy(box.min), this.max.copy(box.max), this;
  }
  makeEmpty() {
    return this.min.x = this.min.y = Infinity, this.max.x = this.max.y = -Infinity, this;
  }
  isEmpty() {
    return this.max.x < this.min.x || this.max.y < this.min.y;
  }
  getCenter(target) {
    return target === void 0 && (console.warn("THREE.Box2: .getCenter() target is now required"), target = new Vector2()), this.isEmpty() ? target.set(0, 0) : target.addVectors(this.min, this.max).multiplyScalar(0.5);
  }
  getSize(target) {
    return target === void 0 && (console.warn("THREE.Box2: .getSize() target is now required"), target = new Vector2()), this.isEmpty() ? target.set(0, 0) : target.subVectors(this.max, this.min);
  }
  expandByPoint(point) {
    return this.min.min(point), this.max.max(point), this;
  }
  expandByVector(vector) {
    return this.min.sub(vector), this.max.add(vector), this;
  }
  expandByScalar(scalar) {
    return this.min.addScalar(-scalar), this.max.addScalar(scalar), this;
  }
  containsPoint(point) {
    return !(point.x < this.min.x || point.x > this.max.x || point.y < this.min.y || point.y > this.max.y);
  }
  containsBox(box) {
    return this.min.x <= box.min.x && box.max.x <= this.max.x && this.min.y <= box.min.y && box.max.y <= this.max.y;
  }
  getParameter(point, target) {
    return target === void 0 && (console.warn("THREE.Box2: .getParameter() target is now required"), target = new Vector2()), target.set((point.x - this.min.x) / (this.max.x - this.min.x), (point.y - this.min.y) / (this.max.y - this.min.y));
  }
  intersectsBox(box) {
    return !(box.max.x < this.min.x || box.min.x > this.max.x || box.max.y < this.min.y || box.min.y > this.max.y);
  }
  clampPoint(point, target) {
    return target === void 0 && (console.warn("THREE.Box2: .clampPoint() target is now required"), target = new Vector2()), target.copy(point).clamp(this.min, this.max);
  }
  distanceToPoint(point) {
    return _vector$4.copy(point).clamp(this.min, this.max).sub(point).length();
  }
  intersect(box) {
    return this.min.max(box.min), this.max.min(box.max), this;
  }
  union(box) {
    return this.min.min(box.min), this.max.max(box.max), this;
  }
  translate(offset) {
    return this.min.add(offset), this.max.add(offset), this;
  }
  equals(box) {
    return box.min.equals(this.min) && box.max.equals(this.max);
  }
};
Box2.prototype.isBox2 = !0;
var _startP = /* @__PURE__ */ new Vector3(), _startEnd = /* @__PURE__ */ new Vector3(), Line3 = class {
  constructor(start = new Vector3(), end = new Vector3()) {
    this.start = start, this.end = end;
  }
  set(start, end) {
    return this.start.copy(start), this.end.copy(end), this;
  }
  copy(line) {
    return this.start.copy(line.start), this.end.copy(line.end), this;
  }
  getCenter(target) {
    return target === void 0 && (console.warn("THREE.Line3: .getCenter() target is now required"), target = new Vector3()), target.addVectors(this.start, this.end).multiplyScalar(0.5);
  }
  delta(target) {
    return target === void 0 && (console.warn("THREE.Line3: .delta() target is now required"), target = new Vector3()), target.subVectors(this.end, this.start);
  }
  distanceSq() {
    return this.start.distanceToSquared(this.end);
  }
  distance() {
    return this.start.distanceTo(this.end);
  }
  at(t, target) {
    return target === void 0 && (console.warn("THREE.Line3: .at() target is now required"), target = new Vector3()), this.delta(target).multiplyScalar(t).add(this.start);
  }
  closestPointToPointParameter(point, clampToLine) {
    _startP.subVectors(point, this.start), _startEnd.subVectors(this.end, this.start);
    let startEnd2 = _startEnd.dot(_startEnd), t = _startEnd.dot(_startP) / startEnd2;
    return clampToLine && (t = clamp(t, 0, 1)), t;
  }
  closestPointToPoint(point, clampToLine, target) {
    let t = this.closestPointToPointParameter(point, clampToLine);
    return target === void 0 && (console.warn("THREE.Line3: .closestPointToPoint() target is now required"), target = new Vector3()), this.delta(target).multiplyScalar(t).add(this.start);
  }
  applyMatrix4(matrix) {
    return this.start.applyMatrix4(matrix), this.end.applyMatrix4(matrix), this;
  }
  equals(line) {
    return line.start.equals(this.start) && line.end.equals(this.end);
  }
  clone() {
    return new this.constructor().copy(this);
  }
}, ImmediateRenderObject = class extends Object3D {
  constructor(material) {
    super();
    this.material = material, this.render = function() {
    }, this.hasPositions = !1, this.hasNormals = !1, this.hasColors = !1, this.hasUvs = !1, this.positionArray = null, this.normalArray = null, this.colorArray = null, this.uvArray = null, this.count = 0;
  }
};
ImmediateRenderObject.prototype.isImmediateRenderObject = !0;
var _vector$2 = /* @__PURE__ */ new Vector3(), _boneMatrix = /* @__PURE__ */ new Matrix4(), _matrixWorldInv = /* @__PURE__ */ new Matrix4(), SkeletonHelper = class extends LineSegments {
  constructor(object) {
    let bones = getBoneList(object), geometry = new BufferGeometry(), vertices = [], colors = [], color1 = new Color(0, 0, 1), color2 = new Color(0, 1, 0);
    for (let i = 0; i < bones.length; i++) {
      let bone = bones[i];
      bone.parent && bone.parent.isBone && (vertices.push(0, 0, 0), vertices.push(0, 0, 0), colors.push(color1.r, color1.g, color1.b), colors.push(color2.r, color2.g, color2.b));
    }
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3)), geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    let material = new LineBasicMaterial({ vertexColors: !0, depthTest: !1, depthWrite: !1, toneMapped: !1, transparent: !0 });
    super(geometry, material);
    this.type = "SkeletonHelper", this.isSkeletonHelper = !0, this.root = object, this.bones = bones, this.matrix = object.matrixWorld, this.matrixAutoUpdate = !1;
  }
  updateMatrixWorld(force) {
    let bones = this.bones, geometry = this.geometry, position = geometry.getAttribute("position");
    _matrixWorldInv.copy(this.root.matrixWorld).invert();
    for (let i = 0, j = 0; i < bones.length; i++) {
      let bone = bones[i];
      bone.parent && bone.parent.isBone && (_boneMatrix.multiplyMatrices(_matrixWorldInv, bone.matrixWorld), _vector$2.setFromMatrixPosition(_boneMatrix), position.setXYZ(j, _vector$2.x, _vector$2.y, _vector$2.z), _boneMatrix.multiplyMatrices(_matrixWorldInv, bone.parent.matrixWorld), _vector$2.setFromMatrixPosition(_boneMatrix), position.setXYZ(j + 1, _vector$2.x, _vector$2.y, _vector$2.z), j += 2);
    }
    geometry.getAttribute("position").needsUpdate = !0, super.updateMatrixWorld(force);
  }
};
function getBoneList(object) {
  let boneList = [];
  object && object.isBone && boneList.push(object);
  for (let i = 0; i < object.children.length; i++)
    boneList.push.apply(boneList, getBoneList(object.children[i]));
  return boneList;
}
var GridHelper = class extends LineSegments {
  constructor(size = 10, divisions = 10, color1 = 4473924, color2 = 8947848) {
    color1 = new Color(color1), color2 = new Color(color2);
    let center = divisions / 2, step = size / divisions, halfSize = size / 2, vertices = [], colors = [];
    for (let i = 0, j = 0, k = -halfSize; i <= divisions; i++, k += step) {
      vertices.push(-halfSize, 0, k, halfSize, 0, k), vertices.push(k, 0, -halfSize, k, 0, halfSize);
      let color = i === center ? color1 : color2;
      color.toArray(colors, j), j += 3, color.toArray(colors, j), j += 3, color.toArray(colors, j), j += 3, color.toArray(colors, j), j += 3;
    }
    let geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3)), geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    let material = new LineBasicMaterial({ vertexColors: !0, toneMapped: !1 });
    super(geometry, material);
    this.type = "GridHelper";
  }
};
var _floatView = new Float32Array(1), _int32View = new Int32Array(_floatView.buffer);
var LOD_MIN = 4, LOD_MAX = 8, SIZE_MAX = Math.pow(2, LOD_MAX), EXTRA_LOD_SIGMA = [0.125, 0.215, 0.35, 0.446, 0.526, 0.582], TOTAL_LODS = LOD_MAX - LOD_MIN + 1 + EXTRA_LOD_SIGMA.length;
var ENCODINGS = {
  [LinearEncoding]: 0,
  [sRGBEncoding]: 1,
  [RGBEEncoding]: 2,
  [RGBM7Encoding]: 3,
  [RGBM16Encoding]: 4,
  [RGBDEncoding]: 5,
  [GammaEncoding]: 6
}, backgroundMaterial = new MeshBasicMaterial({
  side: BackSide,
  depthWrite: !1,
  depthTest: !1
}), backgroundBox = new Mesh(new BoxGeometry(), backgroundMaterial);
var PHI = (1 + Math.sqrt(5)) / 2, INV_PHI = 1 / PHI, _axisDirections = [
  /* @__PURE__ */ new Vector3(1, 1, 1),
  /* @__PURE__ */ new Vector3(-1, 1, 1),
  /* @__PURE__ */ new Vector3(1, 1, -1),
  /* @__PURE__ */ new Vector3(-1, 1, -1),
  /* @__PURE__ */ new Vector3(0, PHI, INV_PHI),
  /* @__PURE__ */ new Vector3(0, PHI, -INV_PHI),
  /* @__PURE__ */ new Vector3(INV_PHI, 0, PHI),
  /* @__PURE__ */ new Vector3(-INV_PHI, 0, PHI),
  /* @__PURE__ */ new Vector3(PHI, INV_PHI, 0),
  /* @__PURE__ */ new Vector3(-PHI, INV_PHI, 0)
];
Curve.create = function(construct, getPoint) {
  return console.log("THREE.Curve.create() has been deprecated"), construct.prototype = Object.create(Curve.prototype), construct.prototype.constructor = construct, construct.prototype.getPoint = getPoint, construct;
};
Path.prototype.fromPoints = function(points) {
  return console.warn("THREE.Path: .fromPoints() has been renamed to .setFromPoints()."), this.setFromPoints(points);
};
GridHelper.prototype.setColors = function() {
  console.error("THREE.GridHelper: setColors() has been deprecated, pass them in the constructor instead.");
};
SkeletonHelper.prototype.update = function() {
  console.error("THREE.SkeletonHelper: update() no longer needs to be called.");
};
Loader.prototype.extractUrlBase = function(url) {
  return console.warn("THREE.Loader: .extractUrlBase() has been deprecated. Use THREE.LoaderUtils.extractUrlBase() instead."), LoaderUtils.extractUrlBase(url);
};
Loader.Handlers = {
  add: function() {
    console.error("THREE.Loader: Handlers.add() has been removed. Use LoadingManager.addHandler() instead.");
  },
  get: function() {
    console.error("THREE.Loader: Handlers.get() has been removed. Use LoadingManager.getHandler() instead.");
  }
};
Box2.prototype.center = function(optionalTarget) {
  return console.warn("THREE.Box2: .center() has been renamed to .getCenter()."), this.getCenter(optionalTarget);
};
Box2.prototype.empty = function() {
  return console.warn("THREE.Box2: .empty() has been renamed to .isEmpty()."), this.isEmpty();
};
Box2.prototype.isIntersectionBox = function(box) {
  return console.warn("THREE.Box2: .isIntersectionBox() has been renamed to .intersectsBox()."), this.intersectsBox(box);
};
Box2.prototype.size = function(optionalTarget) {
  return console.warn("THREE.Box2: .size() has been renamed to .getSize()."), this.getSize(optionalTarget);
};
Box3.prototype.center = function(optionalTarget) {
  return console.warn("THREE.Box3: .center() has been renamed to .getCenter()."), this.getCenter(optionalTarget);
};
Box3.prototype.empty = function() {
  return console.warn("THREE.Box3: .empty() has been renamed to .isEmpty()."), this.isEmpty();
};
Box3.prototype.isIntersectionBox = function(box) {
  return console.warn("THREE.Box3: .isIntersectionBox() has been renamed to .intersectsBox()."), this.intersectsBox(box);
};
Box3.prototype.isIntersectionSphere = function(sphere) {
  return console.warn("THREE.Box3: .isIntersectionSphere() has been renamed to .intersectsSphere()."), this.intersectsSphere(sphere);
};
Box3.prototype.size = function(optionalTarget) {
  return console.warn("THREE.Box3: .size() has been renamed to .getSize()."), this.getSize(optionalTarget);
};
Sphere.prototype.empty = function() {
  return console.warn("THREE.Sphere: .empty() has been renamed to .isEmpty()."), this.isEmpty();
};
Frustum.prototype.setFromMatrix = function(m) {
  return console.warn("THREE.Frustum: .setFromMatrix() has been renamed to .setFromProjectionMatrix()."), this.setFromProjectionMatrix(m);
};
Line3.prototype.center = function(optionalTarget) {
  return console.warn("THREE.Line3: .center() has been renamed to .getCenter()."), this.getCenter(optionalTarget);
};
Matrix3.prototype.flattenToArrayOffset = function(array, offset) {
  return console.warn("THREE.Matrix3: .flattenToArrayOffset() has been deprecated. Use .toArray() instead."), this.toArray(array, offset);
};
Matrix3.prototype.multiplyVector3 = function(vector) {
  return console.warn("THREE.Matrix3: .multiplyVector3() has been removed. Use vector.applyMatrix3( matrix ) instead."), vector.applyMatrix3(this);
};
Matrix3.prototype.multiplyVector3Array = function() {
  console.error("THREE.Matrix3: .multiplyVector3Array() has been removed.");
};
Matrix3.prototype.applyToBufferAttribute = function(attribute) {
  return console.warn("THREE.Matrix3: .applyToBufferAttribute() has been removed. Use attribute.applyMatrix3( matrix ) instead."), attribute.applyMatrix3(this);
};
Matrix3.prototype.applyToVector3Array = function() {
  console.error("THREE.Matrix3: .applyToVector3Array() has been removed.");
};
Matrix3.prototype.getInverse = function(matrix) {
  return console.warn("THREE.Matrix3: .getInverse() has been removed. Use matrixInv.copy( matrix ).invert(); instead."), this.copy(matrix).invert();
};
Matrix4.prototype.extractPosition = function(m) {
  return console.warn("THREE.Matrix4: .extractPosition() has been renamed to .copyPosition()."), this.copyPosition(m);
};
Matrix4.prototype.flattenToArrayOffset = function(array, offset) {
  return console.warn("THREE.Matrix4: .flattenToArrayOffset() has been deprecated. Use .toArray() instead."), this.toArray(array, offset);
};
Matrix4.prototype.getPosition = function() {
  return console.warn("THREE.Matrix4: .getPosition() has been removed. Use Vector3.setFromMatrixPosition( matrix ) instead."), new Vector3().setFromMatrixColumn(this, 3);
};
Matrix4.prototype.setRotationFromQuaternion = function(q) {
  return console.warn("THREE.Matrix4: .setRotationFromQuaternion() has been renamed to .makeRotationFromQuaternion()."), this.makeRotationFromQuaternion(q);
};
Matrix4.prototype.multiplyToArray = function() {
  console.warn("THREE.Matrix4: .multiplyToArray() has been removed.");
};
Matrix4.prototype.multiplyVector3 = function(vector) {
  return console.warn("THREE.Matrix4: .multiplyVector3() has been removed. Use vector.applyMatrix4( matrix ) instead."), vector.applyMatrix4(this);
};
Matrix4.prototype.multiplyVector4 = function(vector) {
  return console.warn("THREE.Matrix4: .multiplyVector4() has been removed. Use vector.applyMatrix4( matrix ) instead."), vector.applyMatrix4(this);
};
Matrix4.prototype.multiplyVector3Array = function() {
  console.error("THREE.Matrix4: .multiplyVector3Array() has been removed.");
};
Matrix4.prototype.rotateAxis = function(v) {
  console.warn("THREE.Matrix4: .rotateAxis() has been removed. Use Vector3.transformDirection( matrix ) instead."), v.transformDirection(this);
};
Matrix4.prototype.crossVector = function(vector) {
  return console.warn("THREE.Matrix4: .crossVector() has been removed. Use vector.applyMatrix4( matrix ) instead."), vector.applyMatrix4(this);
};
Matrix4.prototype.translate = function() {
  console.error("THREE.Matrix4: .translate() has been removed.");
};
Matrix4.prototype.rotateX = function() {
  console.error("THREE.Matrix4: .rotateX() has been removed.");
};
Matrix4.prototype.rotateY = function() {
  console.error("THREE.Matrix4: .rotateY() has been removed.");
};
Matrix4.prototype.rotateZ = function() {
  console.error("THREE.Matrix4: .rotateZ() has been removed.");
};
Matrix4.prototype.rotateByAxis = function() {
  console.error("THREE.Matrix4: .rotateByAxis() has been removed.");
};
Matrix4.prototype.applyToBufferAttribute = function(attribute) {
  return console.warn("THREE.Matrix4: .applyToBufferAttribute() has been removed. Use attribute.applyMatrix4( matrix ) instead."), attribute.applyMatrix4(this);
};
Matrix4.prototype.applyToVector3Array = function() {
  console.error("THREE.Matrix4: .applyToVector3Array() has been removed.");
};
Matrix4.prototype.makeFrustum = function(left, right, bottom, top, near, far) {
  return console.warn("THREE.Matrix4: .makeFrustum() has been removed. Use .makePerspective( left, right, top, bottom, near, far ) instead."), this.makePerspective(left, right, top, bottom, near, far);
};
Matrix4.prototype.getInverse = function(matrix) {
  return console.warn("THREE.Matrix4: .getInverse() has been removed. Use matrixInv.copy( matrix ).invert(); instead."), this.copy(matrix).invert();
};
Plane.prototype.isIntersectionLine = function(line) {
  return console.warn("THREE.Plane: .isIntersectionLine() has been renamed to .intersectsLine()."), this.intersectsLine(line);
};
Quaternion.prototype.multiplyVector3 = function(vector) {
  return console.warn("THREE.Quaternion: .multiplyVector3() has been removed. Use is now vector.applyQuaternion( quaternion ) instead."), vector.applyQuaternion(this);
};
Quaternion.prototype.inverse = function() {
  return console.warn("THREE.Quaternion: .inverse() has been renamed to invert()."), this.invert();
};
Ray.prototype.isIntersectionBox = function(box) {
  return console.warn("THREE.Ray: .isIntersectionBox() has been renamed to .intersectsBox()."), this.intersectsBox(box);
};
Ray.prototype.isIntersectionPlane = function(plane) {
  return console.warn("THREE.Ray: .isIntersectionPlane() has been renamed to .intersectsPlane()."), this.intersectsPlane(plane);
};
Ray.prototype.isIntersectionSphere = function(sphere) {
  return console.warn("THREE.Ray: .isIntersectionSphere() has been renamed to .intersectsSphere()."), this.intersectsSphere(sphere);
};
Triangle.prototype.area = function() {
  return console.warn("THREE.Triangle: .area() has been renamed to .getArea()."), this.getArea();
};
Triangle.prototype.barycoordFromPoint = function(point, target) {
  return console.warn("THREE.Triangle: .barycoordFromPoint() has been renamed to .getBarycoord()."), this.getBarycoord(point, target);
};
Triangle.prototype.midpoint = function(target) {
  return console.warn("THREE.Triangle: .midpoint() has been renamed to .getMidpoint()."), this.getMidpoint(target);
};
Triangle.prototypenormal = function(target) {
  return console.warn("THREE.Triangle: .normal() has been renamed to .getNormal()."), this.getNormal(target);
};
Triangle.prototype.plane = function(target) {
  return console.warn("THREE.Triangle: .plane() has been renamed to .getPlane()."), this.getPlane(target);
};
Triangle.barycoordFromPoint = function(point, a, b, c, target) {
  return console.warn("THREE.Triangle: .barycoordFromPoint() has been renamed to .getBarycoord()."), Triangle.getBarycoord(point, a, b, c, target);
};
Triangle.normal = function(a, b, c, target) {
  return console.warn("THREE.Triangle: .normal() has been renamed to .getNormal()."), Triangle.getNormal(a, b, c, target);
};
Shape.prototype.extractAllPoints = function(divisions) {
  return console.warn("THREE.Shape: .extractAllPoints() has been removed. Use .extractPoints() instead."), this.extractPoints(divisions);
};
Shape.prototype.extrude = function(options) {
  return console.warn("THREE.Shape: .extrude() has been removed. Use ExtrudeGeometry() instead."), new ExtrudeGeometry(this, options);
};
Shape.prototype.makeGeometry = function(options) {
  return console.warn("THREE.Shape: .makeGeometry() has been removed. Use ShapeGeometry() instead."), new ShapeGeometry(this, options);
};
Vector2.prototype.fromAttribute = function(attribute, index, offset) {
  return console.warn("THREE.Vector2: .fromAttribute() has been renamed to .fromBufferAttribute()."), this.fromBufferAttribute(attribute, index, offset);
};
Vector2.prototype.distanceToManhattan = function(v) {
  return console.warn("THREE.Vector2: .distanceToManhattan() has been renamed to .manhattanDistanceTo()."), this.manhattanDistanceTo(v);
};
Vector2.prototype.lengthManhattan = function() {
  return console.warn("THREE.Vector2: .lengthManhattan() has been renamed to .manhattanLength()."), this.manhattanLength();
};
Vector3.prototype.setEulerFromRotationMatrix = function() {
  console.error("THREE.Vector3: .setEulerFromRotationMatrix() has been removed. Use Euler.setFromRotationMatrix() instead.");
};
Vector3.prototype.setEulerFromQuaternion = function() {
  console.error("THREE.Vector3: .setEulerFromQuaternion() has been removed. Use Euler.setFromQuaternion() instead.");
};
Vector3.prototype.getPositionFromMatrix = function(m) {
  return console.warn("THREE.Vector3: .getPositionFromMatrix() has been renamed to .setFromMatrixPosition()."), this.setFromMatrixPosition(m);
};
Vector3.prototype.getScaleFromMatrix = function(m) {
  return console.warn("THREE.Vector3: .getScaleFromMatrix() has been renamed to .setFromMatrixScale()."), this.setFromMatrixScale(m);
};
Vector3.prototype.getColumnFromMatrix = function(index, matrix) {
  return console.warn("THREE.Vector3: .getColumnFromMatrix() has been renamed to .setFromMatrixColumn()."), this.setFromMatrixColumn(matrix, index);
};
Vector3.prototype.applyProjection = function(m) {
  return console.warn("THREE.Vector3: .applyProjection() has been removed. Use .applyMatrix4( m ) instead."), this.applyMatrix4(m);
};
Vector3.prototype.fromAttribute = function(attribute, index, offset) {
  return console.warn("THREE.Vector3: .fromAttribute() has been renamed to .fromBufferAttribute()."), this.fromBufferAttribute(attribute, index, offset);
};
Vector3.prototype.distanceToManhattan = function(v) {
  return console.warn("THREE.Vector3: .distanceToManhattan() has been renamed to .manhattanDistanceTo()."), this.manhattanDistanceTo(v);
};
Vector3.prototype.lengthManhattan = function() {
  return console.warn("THREE.Vector3: .lengthManhattan() has been renamed to .manhattanLength()."), this.manhattanLength();
};
Vector4.prototype.fromAttribute = function(attribute, index, offset) {
  return console.warn("THREE.Vector4: .fromAttribute() has been renamed to .fromBufferAttribute()."), this.fromBufferAttribute(attribute, index, offset);
};
Vector4.prototype.lengthManhattan = function() {
  return console.warn("THREE.Vector4: .lengthManhattan() has been renamed to .manhattanLength()."), this.manhattanLength();
};
Object3D.prototype.getChildByName = function(name) {
  return console.warn("THREE.Object3D: .getChildByName() has been renamed to .getObjectByName()."), this.getObjectByName(name);
};
Object3D.prototype.renderDepth = function() {
  console.warn("THREE.Object3D: .renderDepth has been removed. Use .renderOrder, instead.");
};
Object3D.prototype.translate = function(distance, axis) {
  return console.warn("THREE.Object3D: .translate() has been removed. Use .translateOnAxis( axis, distance ) instead."), this.translateOnAxis(axis, distance);
};
Object3D.prototype.getWorldRotation = function() {
  console.error("THREE.Object3D: .getWorldRotation() has been removed. Use THREE.Object3D.getWorldQuaternion( target ) instead.");
};
Object3D.prototype.applyMatrix = function(matrix) {
  return console.warn("THREE.Object3D: .applyMatrix() has been renamed to .applyMatrix4()."), this.applyMatrix4(matrix);
};
Object.defineProperties(Object3D.prototype, {
  eulerOrder: {
    get: function() {
      return console.warn("THREE.Object3D: .eulerOrder is now .rotation.order."), this.rotation.order;
    },
    set: function(value) {
      console.warn("THREE.Object3D: .eulerOrder is now .rotation.order."), this.rotation.order = value;
    }
  },
  useQuaternion: {
    get: function() {
      console.warn("THREE.Object3D: .useQuaternion has been removed. The library now uses quaternions by default.");
    },
    set: function() {
      console.warn("THREE.Object3D: .useQuaternion has been removed. The library now uses quaternions by default.");
    }
  }
});
Mesh.prototype.setDrawMode = function() {
  console.error("THREE.Mesh: .setDrawMode() has been removed. The renderer now always assumes THREE.TrianglesDrawMode. Transform your geometry via BufferGeometryUtils.toTrianglesDrawMode() if necessary.");
};
Object.defineProperties(Mesh.prototype, {
  drawMode: {
    get: function() {
      return console.error("THREE.Mesh: .drawMode has been removed. The renderer now always assumes THREE.TrianglesDrawMode."), TrianglesDrawMode;
    },
    set: function() {
      console.error("THREE.Mesh: .drawMode has been removed. The renderer now always assumes THREE.TrianglesDrawMode. Transform your geometry via BufferGeometryUtils.toTrianglesDrawMode() if necessary.");
    }
  }
});
SkinnedMesh.prototype.initBones = function() {
  console.error("THREE.SkinnedMesh: initBones() has been removed.");
};
PerspectiveCamera.prototype.setLens = function(focalLength, filmGauge) {
  console.warn("THREE.PerspectiveCamera.setLens is deprecated. Use .setFocalLength and .filmGauge for a photographic setup."), filmGauge !== void 0 && (this.filmGauge = filmGauge), this.setFocalLength(focalLength);
};
Object.defineProperties(Light.prototype, {
  onlyShadow: {
    set: function() {
      console.warn("THREE.Light: .onlyShadow has been removed.");
    }
  },
  shadowCameraFov: {
    set: function(value) {
      console.warn("THREE.Light: .shadowCameraFov is now .shadow.camera.fov."), this.shadow.camera.fov = value;
    }
  },
  shadowCameraLeft: {
    set: function(value) {
      console.warn("THREE.Light: .shadowCameraLeft is now .shadow.camera.left."), this.shadow.camera.left = value;
    }
  },
  shadowCameraRight: {
    set: function(value) {
      console.warn("THREE.Light: .shadowCameraRight is now .shadow.camera.right."), this.shadow.camera.right = value;
    }
  },
  shadowCameraTop: {
    set: function(value) {
      console.warn("THREE.Light: .shadowCameraTop is now .shadow.camera.top."), this.shadow.camera.top = value;
    }
  },
  shadowCameraBottom: {
    set: function(value) {
      console.warn("THREE.Light: .shadowCameraBottom is now .shadow.camera.bottom."), this.shadow.camera.bottom = value;
    }
  },
  shadowCameraNear: {
    set: function(value) {
      console.warn("THREE.Light: .shadowCameraNear is now .shadow.camera.near."), this.shadow.camera.near = value;
    }
  },
  shadowCameraFar: {
    set: function(value) {
      console.warn("THREE.Light: .shadowCameraFar is now .shadow.camera.far."), this.shadow.camera.far = value;
    }
  },
  shadowCameraVisible: {
    set: function() {
      console.warn("THREE.Light: .shadowCameraVisible has been removed. Use new THREE.CameraHelper( light.shadow.camera ) instead.");
    }
  },
  shadowBias: {
    set: function(value) {
      console.warn("THREE.Light: .shadowBias is now .shadow.bias."), this.shadow.bias = value;
    }
  },
  shadowDarkness: {
    set: function() {
      console.warn("THREE.Light: .shadowDarkness has been removed.");
    }
  },
  shadowMapWidth: {
    set: function(value) {
      console.warn("THREE.Light: .shadowMapWidth is now .shadow.mapSize.width."), this.shadow.mapSize.width = value;
    }
  },
  shadowMapHeight: {
    set: function(value) {
      console.warn("THREE.Light: .shadowMapHeight is now .shadow.mapSize.height."), this.shadow.mapSize.height = value;
    }
  }
});
Object.defineProperties(BufferAttribute.prototype, {
  length: {
    get: function() {
      return console.warn("THREE.BufferAttribute: .length has been deprecated. Use .count instead."), this.array.length;
    }
  },
  dynamic: {
    get: function() {
      return console.warn("THREE.BufferAttribute: .dynamic has been deprecated. Use .usage instead."), this.usage === DynamicDrawUsage;
    },
    set: function() {
      console.warn("THREE.BufferAttribute: .dynamic has been deprecated. Use .usage instead."), this.setUsage(DynamicDrawUsage);
    }
  }
});
BufferAttribute.prototype.setDynamic = function(value) {
  return console.warn("THREE.BufferAttribute: .setDynamic() has been deprecated. Use .setUsage() instead."), this.setUsage(value === !0 ? DynamicDrawUsage : StaticDrawUsage), this;
};
BufferAttribute.prototype.copyIndicesArray = function() {
  console.error("THREE.BufferAttribute: .copyIndicesArray() has been removed.");
}, BufferAttribute.prototype.setArray = function() {
  console.error("THREE.BufferAttribute: .setArray has been removed. Use BufferGeometry .setAttribute to replace/resize attribute buffers");
};
BufferGeometry.prototype.addIndex = function(index) {
  console.warn("THREE.BufferGeometry: .addIndex() has been renamed to .setIndex()."), this.setIndex(index);
};
BufferGeometry.prototype.addAttribute = function(name, attribute) {
  return console.warn("THREE.BufferGeometry: .addAttribute() has been renamed to .setAttribute()."), !(attribute && attribute.isBufferAttribute) && !(attribute && attribute.isInterleavedBufferAttribute) ? (console.warn("THREE.BufferGeometry: .addAttribute() now expects ( name, attribute )."), this.setAttribute(name, new BufferAttribute(arguments[1], arguments[2]))) : name === "index" ? (console.warn("THREE.BufferGeometry.addAttribute: Use .setIndex() for index attribute."), this.setIndex(attribute), this) : this.setAttribute(name, attribute);
};
BufferGeometry.prototype.addDrawCall = function(start, count, indexOffset) {
  indexOffset !== void 0 && console.warn("THREE.BufferGeometry: .addDrawCall() no longer supports indexOffset."), console.warn("THREE.BufferGeometry: .addDrawCall() is now .addGroup()."), this.addGroup(start, count);
};
BufferGeometry.prototype.clearDrawCalls = function() {
  console.warn("THREE.BufferGeometry: .clearDrawCalls() is now .clearGroups()."), this.clearGroups();
};
BufferGeometry.prototype.computeOffsets = function() {
  console.warn("THREE.BufferGeometry: .computeOffsets() has been removed.");
};
BufferGeometry.prototype.removeAttribute = function(name) {
  return console.warn("THREE.BufferGeometry: .removeAttribute() has been renamed to .deleteAttribute()."), this.deleteAttribute(name);
};
BufferGeometry.prototype.applyMatrix = function(matrix) {
  return console.warn("THREE.BufferGeometry: .applyMatrix() has been renamed to .applyMatrix4()."), this.applyMatrix4(matrix);
};
Object.defineProperties(BufferGeometry.prototype, {
  drawcalls: {
    get: function() {
      return console.error("THREE.BufferGeometry: .drawcalls has been renamed to .groups."), this.groups;
    }
  },
  offsets: {
    get: function() {
      return console.warn("THREE.BufferGeometry: .offsets has been renamed to .groups."), this.groups;
    }
  }
});
InterleavedBuffer.prototype.setDynamic = function(value) {
  return console.warn("THREE.InterleavedBuffer: .setDynamic() has been deprecated. Use .setUsage() instead."), this.setUsage(value === !0 ? DynamicDrawUsage : StaticDrawUsage), this;
};
InterleavedBuffer.prototype.setArray = function() {
  console.error("THREE.InterleavedBuffer: .setArray has been removed. Use BufferGeometry .setAttribute to replace/resize attribute buffers");
};
ExtrudeGeometry.prototype.getArrays = function() {
  console.error("THREE.ExtrudeGeometry: .getArrays() has been removed.");
};
ExtrudeGeometry.prototype.addShapeList = function() {
  console.error("THREE.ExtrudeGeometry: .addShapeList() has been removed.");
};
ExtrudeGeometry.prototype.addShape = function() {
  console.error("THREE.ExtrudeGeometry: .addShape() has been removed.");
};
Scene.prototype.dispose = function() {
  console.error("THREE.Scene: .dispose() has been removed.");
};
Uniform.prototype.onUpdate = function() {
  return console.warn("THREE.Uniform: .onUpdate() has been removed. Use object.onBeforeRender() instead."), this;
};
Object.defineProperties(Material.prototype, {
  wrapAround: {
    get: function() {
      console.warn("THREE.Material: .wrapAround has been removed.");
    },
    set: function() {
      console.warn("THREE.Material: .wrapAround has been removed.");
    }
  },
  overdraw: {
    get: function() {
      console.warn("THREE.Material: .overdraw has been removed.");
    },
    set: function() {
      console.warn("THREE.Material: .overdraw has been removed.");
    }
  },
  wrapRGB: {
    get: function() {
      return console.warn("THREE.Material: .wrapRGB has been removed."), new Color();
    }
  },
  shading: {
    get: function() {
      console.error("THREE." + this.type + ": .shading has been removed. Use the boolean .flatShading instead.");
    },
    set: function(value) {
      console.warn("THREE." + this.type + ": .shading has been removed. Use the boolean .flatShading instead."), this.flatShading = value === FlatShading;
    }
  },
  stencilMask: {
    get: function() {
      return console.warn("THREE." + this.type + ": .stencilMask has been removed. Use .stencilFuncMask instead."), this.stencilFuncMask;
    },
    set: function(value) {
      console.warn("THREE." + this.type + ": .stencilMask has been removed. Use .stencilFuncMask instead."), this.stencilFuncMask = value;
    }
  }
});
Object.defineProperties(ShaderMaterial.prototype, {
  derivatives: {
    get: function() {
      return console.warn("THREE.ShaderMaterial: .derivatives has been moved to .extensions.derivatives."), this.extensions.derivatives;
    },
    set: function(value) {
      console.warn("THREE. ShaderMaterial: .derivatives has been moved to .extensions.derivatives."), this.extensions.derivatives = value;
    }
  }
});
WebGLRenderer.prototype.clearTarget = function(renderTarget, color, depth, stencil) {
  console.warn("THREE.WebGLRenderer: .clearTarget() has been deprecated. Use .setRenderTarget() and .clear() instead."), this.setRenderTarget(renderTarget), this.clear(color, depth, stencil);
};
WebGLRenderer.prototype.animate = function(callback) {
  console.warn("THREE.WebGLRenderer: .animate() is now .setAnimationLoop()."), this.setAnimationLoop(callback);
};
WebGLRenderer.prototype.getCurrentRenderTarget = function() {
  return console.warn("THREE.WebGLRenderer: .getCurrentRenderTarget() is now .getRenderTarget()."), this.getRenderTarget();
};
WebGLRenderer.prototype.getMaxAnisotropy = function() {
  return console.warn("THREE.WebGLRenderer: .getMaxAnisotropy() is now .capabilities.getMaxAnisotropy()."), this.capabilities.getMaxAnisotropy();
};
WebGLRenderer.prototype.getPrecision = function() {
  return console.warn("THREE.WebGLRenderer: .getPrecision() is now .capabilities.precision."), this.capabilities.precision;
};
WebGLRenderer.prototype.resetGLState = function() {
  return console.warn("THREE.WebGLRenderer: .resetGLState() is now .state.reset()."), this.state.reset();
};
WebGLRenderer.prototype.supportsFloatTextures = function() {
  return console.warn("THREE.WebGLRenderer: .supportsFloatTextures() is now .extensions.get( 'OES_texture_float' )."), this.extensions.get("OES_texture_float");
};
WebGLRenderer.prototype.supportsHalfFloatTextures = function() {
  return console.warn("THREE.WebGLRenderer: .supportsHalfFloatTextures() is now .extensions.get( 'OES_texture_half_float' )."), this.extensions.get("OES_texture_half_float");
};
WebGLRenderer.prototype.supportsStandardDerivatives = function() {
  return console.warn("THREE.WebGLRenderer: .supportsStandardDerivatives() is now .extensions.get( 'OES_standard_derivatives' )."), this.extensions.get("OES_standard_derivatives");
};
WebGLRenderer.prototype.supportsCompressedTextureS3TC = function() {
  return console.warn("THREE.WebGLRenderer: .supportsCompressedTextureS3TC() is now .extensions.get( 'WEBGL_compressed_texture_s3tc' )."), this.extensions.get("WEBGL_compressed_texture_s3tc");
};
WebGLRenderer.prototype.supportsCompressedTexturePVRTC = function() {
  return console.warn("THREE.WebGLRenderer: .supportsCompressedTexturePVRTC() is now .extensions.get( 'WEBGL_compressed_texture_pvrtc' )."), this.extensions.get("WEBGL_compressed_texture_pvrtc");
};
WebGLRenderer.prototype.supportsBlendMinMax = function() {
  return console.warn("THREE.WebGLRenderer: .supportsBlendMinMax() is now .extensions.get( 'EXT_blend_minmax' )."), this.extensions.get("EXT_blend_minmax");
};
WebGLRenderer.prototype.supportsVertexTextures = function() {
  return console.warn("THREE.WebGLRenderer: .supportsVertexTextures() is now .capabilities.vertexTextures."), this.capabilities.vertexTextures;
};
WebGLRenderer.prototype.supportsInstancedArrays = function() {
  return console.warn("THREE.WebGLRenderer: .supportsInstancedArrays() is now .extensions.get( 'ANGLE_instanced_arrays' )."), this.extensions.get("ANGLE_instanced_arrays");
};
WebGLRenderer.prototype.enableScissorTest = function(boolean) {
  console.warn("THREE.WebGLRenderer: .enableScissorTest() is now .setScissorTest()."), this.setScissorTest(boolean);
};
WebGLRenderer.prototype.initMaterial = function() {
  console.warn("THREE.WebGLRenderer: .initMaterial() has been removed.");
};
WebGLRenderer.prototype.addPrePlugin = function() {
  console.warn("THREE.WebGLRenderer: .addPrePlugin() has been removed.");
};
WebGLRenderer.prototype.addPostPlugin = function() {
  console.warn("THREE.WebGLRenderer: .addPostPlugin() has been removed.");
};
WebGLRenderer.prototype.updateShadowMap = function() {
  console.warn("THREE.WebGLRenderer: .updateShadowMap() has been removed.");
};
WebGLRenderer.prototype.setFaceCulling = function() {
  console.warn("THREE.WebGLRenderer: .setFaceCulling() has been removed.");
};
WebGLRenderer.prototype.allocTextureUnit = function() {
  console.warn("THREE.WebGLRenderer: .allocTextureUnit() has been removed.");
};
WebGLRenderer.prototype.setTexture = function() {
  console.warn("THREE.WebGLRenderer: .setTexture() has been removed.");
};
WebGLRenderer.prototype.setTexture2D = function() {
  console.warn("THREE.WebGLRenderer: .setTexture2D() has been removed.");
};
WebGLRenderer.prototype.setTextureCube = function() {
  console.warn("THREE.WebGLRenderer: .setTextureCube() has been removed.");
};
WebGLRenderer.prototype.getActiveMipMapLevel = function() {
  return console.warn("THREE.WebGLRenderer: .getActiveMipMapLevel() is now .getActiveMipmapLevel()."), this.getActiveMipmapLevel();
};
Object.defineProperties(WebGLRenderer.prototype, {
  shadowMapEnabled: {
    get: function() {
      return this.shadowMap.enabled;
    },
    set: function(value) {
      console.warn("THREE.WebGLRenderer: .shadowMapEnabled is now .shadowMap.enabled."), this.shadowMap.enabled = value;
    }
  },
  shadowMapType: {
    get: function() {
      return this.shadowMap.type;
    },
    set: function(value) {
      console.warn("THREE.WebGLRenderer: .shadowMapType is now .shadowMap.type."), this.shadowMap.type = value;
    }
  },
  shadowMapCullFace: {
    get: function() {
      console.warn("THREE.WebGLRenderer: .shadowMapCullFace has been removed. Set Material.shadowSide instead.");
    },
    set: function() {
      console.warn("THREE.WebGLRenderer: .shadowMapCullFace has been removed. Set Material.shadowSide instead.");
    }
  },
  context: {
    get: function() {
      return console.warn("THREE.WebGLRenderer: .context has been removed. Use .getContext() instead."), this.getContext();
    }
  },
  vr: {
    get: function() {
      return console.warn("THREE.WebGLRenderer: .vr has been renamed to .xr"), this.xr;
    }
  },
  gammaInput: {
    get: function() {
      return console.warn("THREE.WebGLRenderer: .gammaInput has been removed. Set the encoding for textures via Texture.encoding instead."), !1;
    },
    set: function() {
      console.warn("THREE.WebGLRenderer: .gammaInput has been removed. Set the encoding for textures via Texture.encoding instead.");
    }
  },
  gammaOutput: {
    get: function() {
      return console.warn("THREE.WebGLRenderer: .gammaOutput has been removed. Set WebGLRenderer.outputEncoding instead."), !1;
    },
    set: function(value) {
      console.warn("THREE.WebGLRenderer: .gammaOutput has been removed. Set WebGLRenderer.outputEncoding instead."), this.outputEncoding = value === !0 ? sRGBEncoding : LinearEncoding;
    }
  },
  toneMappingWhitePoint: {
    get: function() {
      return console.warn("THREE.WebGLRenderer: .toneMappingWhitePoint has been removed."), 1;
    },
    set: function() {
      console.warn("THREE.WebGLRenderer: .toneMappingWhitePoint has been removed.");
    }
  }
});
Object.defineProperties(WebGLShadowMap.prototype, {
  cullFace: {
    get: function() {
      console.warn("THREE.WebGLRenderer: .shadowMap.cullFace has been removed. Set Material.shadowSide instead.");
    },
    set: function() {
      console.warn("THREE.WebGLRenderer: .shadowMap.cullFace has been removed. Set Material.shadowSide instead.");
    }
  },
  renderReverseSided: {
    get: function() {
      console.warn("THREE.WebGLRenderer: .shadowMap.renderReverseSided has been removed. Set Material.shadowSide instead.");
    },
    set: function() {
      console.warn("THREE.WebGLRenderer: .shadowMap.renderReverseSided has been removed. Set Material.shadowSide instead.");
    }
  },
  renderSingleSided: {
    get: function() {
      console.warn("THREE.WebGLRenderer: .shadowMap.renderSingleSided has been removed. Set Material.shadowSide instead.");
    },
    set: function() {
      console.warn("THREE.WebGLRenderer: .shadowMap.renderSingleSided has been removed. Set Material.shadowSide instead.");
    }
  }
});
Object.defineProperties(WebGLRenderTarget.prototype, {
  wrapS: {
    get: function() {
      return console.warn("THREE.WebGLRenderTarget: .wrapS is now .texture.wrapS."), this.texture.wrapS;
    },
    set: function(value) {
      console.warn("THREE.WebGLRenderTarget: .wrapS is now .texture.wrapS."), this.texture.wrapS = value;
    }
  },
  wrapT: {
    get: function() {
      return console.warn("THREE.WebGLRenderTarget: .wrapT is now .texture.wrapT."), this.texture.wrapT;
    },
    set: function(value) {
      console.warn("THREE.WebGLRenderTarget: .wrapT is now .texture.wrapT."), this.texture.wrapT = value;
    }
  },
  magFilter: {
    get: function() {
      return console.warn("THREE.WebGLRenderTarget: .magFilter is now .texture.magFilter."), this.texture.magFilter;
    },
    set: function(value) {
      console.warn("THREE.WebGLRenderTarget: .magFilter is now .texture.magFilter."), this.texture.magFilter = value;
    }
  },
  minFilter: {
    get: function() {
      return console.warn("THREE.WebGLRenderTarget: .minFilter is now .texture.minFilter."), this.texture.minFilter;
    },
    set: function(value) {
      console.warn("THREE.WebGLRenderTarget: .minFilter is now .texture.minFilter."), this.texture.minFilter = value;
    }
  },
  anisotropy: {
    get: function() {
      return console.warn("THREE.WebGLRenderTarget: .anisotropy is now .texture.anisotropy."), this.texture.anisotropy;
    },
    set: function(value) {
      console.warn("THREE.WebGLRenderTarget: .anisotropy is now .texture.anisotropy."), this.texture.anisotropy = value;
    }
  },
  offset: {
    get: function() {
      return console.warn("THREE.WebGLRenderTarget: .offset is now .texture.offset."), this.texture.offset;
    },
    set: function(value) {
      console.warn("THREE.WebGLRenderTarget: .offset is now .texture.offset."), this.texture.offset = value;
    }
  },
  repeat: {
    get: function() {
      return console.warn("THREE.WebGLRenderTarget: .repeat is now .texture.repeat."), this.texture.repeat;
    },
    set: function(value) {
      console.warn("THREE.WebGLRenderTarget: .repeat is now .texture.repeat."), this.texture.repeat = value;
    }
  },
  format: {
    get: function() {
      return console.warn("THREE.WebGLRenderTarget: .format is now .texture.format."), this.texture.format;
    },
    set: function(value) {
      console.warn("THREE.WebGLRenderTarget: .format is now .texture.format."), this.texture.format = value;
    }
  },
  type: {
    get: function() {
      return console.warn("THREE.WebGLRenderTarget: .type is now .texture.type."), this.texture.type;
    },
    set: function(value) {
      console.warn("THREE.WebGLRenderTarget: .type is now .texture.type."), this.texture.type = value;
    }
  },
  generateMipmaps: {
    get: function() {
      return console.warn("THREE.WebGLRenderTarget: .generateMipmaps is now .texture.generateMipmaps."), this.texture.generateMipmaps;
    },
    set: function(value) {
      console.warn("THREE.WebGLRenderTarget: .generateMipmaps is now .texture.generateMipmaps."), this.texture.generateMipmaps = value;
    }
  }
});
Audio.prototype.load = function(file) {
  console.warn("THREE.Audio: .load has been deprecated. Use THREE.AudioLoader instead.");
  let scope = this;
  return new AudioLoader().load(file, function(buffer) {
    scope.setBuffer(buffer);
  }), this;
};
AudioAnalyser.prototype.getData = function() {
  return console.warn("THREE.AudioAnalyser: .getData() is now .getFrequencyData()."), this.getFrequencyData();
};
CubeCamera.prototype.updateCubeMap = function(renderer, scene) {
  return console.warn("THREE.CubeCamera: .updateCubeMap() is now .update()."), this.update(renderer, scene);
};
CubeCamera.prototype.clear = function(renderer, color, depth, stencil) {
  return console.warn("THREE.CubeCamera: .clear() is now .renderTarget.clear()."), this.renderTarget.clear(renderer, color, depth, stencil);
};
ImageUtils.crossOrigin = void 0;
ImageUtils.loadTexture = function(url, mapping, onLoad, onError) {
  console.warn("THREE.ImageUtils.loadTexture has been deprecated. Use THREE.TextureLoader() instead.");
  let loader = new TextureLoader();
  loader.setCrossOrigin(this.crossOrigin);
  let texture = loader.load(url, onLoad, void 0, onError);
  return mapping && (texture.mapping = mapping), texture;
};
ImageUtils.loadTextureCube = function(urls, mapping, onLoad, onError) {
  console.warn("THREE.ImageUtils.loadTextureCube has been deprecated. Use THREE.CubeTextureLoader() instead.");
  let loader = new CubeTextureLoader();
  loader.setCrossOrigin(this.crossOrigin);
  let texture = loader.load(urls, onLoad, void 0, onError);
  return mapping && (texture.mapping = mapping), texture;
};
ImageUtils.loadCompressedTexture = function() {
  console.error("THREE.ImageUtils.loadCompressedTexture has been removed. Use THREE.DDSLoader instead.");
};
ImageUtils.loadCompressedTextureCube = function() {
  console.error("THREE.ImageUtils.loadCompressedTextureCube has been removed. Use THREE.DDSLoader instead.");
};
typeof __THREE_DEVTOOLS__ != "undefined" && __THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register", { detail: {
  revision: REVISION
} }));
typeof window != "undefined" && (window.__THREE__ ? console.warn("WARNING: Multiple instances of Three.js being imported.") : window.__THREE__ = REVISION);

// src/utils/vmd.ts
var VMDLoaderWrapper = class {
  constructor() {
    this.boneMapping = [
      { bone: "hips", nodeNames: ["\u30BB\u30F3\u30BF\u30FC", "center"] },
      { bone: "spine", nodeNames: ["\u4E0A\u534A\u8EAB", "upper body"] },
      { bone: "chest", nodeNames: ["\u4E0A\u534A\u8EAB2", "upper body2"] },
      { bone: "neck", nodeNames: ["\u9996", "neck"] },
      { bone: "head", nodeNames: ["\u982D", "head"] },
      { bone: "leftShoulder", nodeNames: ["\u5DE6\u80A9", "shoulder_L"] },
      { bone: "leftUpperArm", nodeNames: ["\u5DE6\u8155", "arm_L"] },
      { bone: "leftLowerArm", nodeNames: ["\u5DE6\u3072\u3058", "elbow_L"] },
      { bone: "leftHand", nodeNames: ["\u5DE6\u624B\u9996", "wrist_L"] },
      { bone: "rightShoulder", nodeNames: ["\u53F3\u80A9", "shoulder_R"] },
      { bone: "rightUpperArm", nodeNames: ["\u53F3\u8155", "arm_R"] },
      { bone: "rightLowerArm", nodeNames: ["\u53F3\u3072\u3058", "elbow_R"] },
      { bone: "rightHand", nodeNames: ["\u53F3\u624B\u9996", "wrist_R"] },
      { bone: "leftUpperLeg", nodeNames: ["\u5DE6\u8DB3", "leg_L"] },
      { bone: "leftLowerLeg", nodeNames: ["\u5DE6\u3072\u3056", "knee_L"] },
      { bone: "leftFoot", nodeNames: ["\u5DE6\u8DB3\u9996", "ankle_L"] },
      { bone: "leftToes", nodeNames: ["\u5DE6\u3064\u307E\u5148", "L toe"] },
      { bone: "rightUpperLeg", nodeNames: ["\u53F3\u8DB3", "leg_R"] },
      { bone: "rightLowerLeg", nodeNames: ["\u53F3\u3072\u3056", "knee_R"] },
      { bone: "rightFoot", nodeNames: ["\u53F3\u8DB3\u9996", "ankle_R"] },
      { bone: "rightToes", nodeNames: ["\u53F3\u3064\u307E\u5148", "R toe"] },
      { bone: "leftEye", nodeNames: ["\u5DE6\u76EE", "eye_L"] },
      { bone: "rightEye", nodeNames: ["\u53F3\u76EE", "eye_R"] },
      { bone: "leftThumbProximal", nodeNames: ["\u5DE6\u89AA\u6307\uFF10", "thumb0_L"] },
      { bone: "leftThumbIntermediate", nodeNames: ["\u5DE6\u89AA\u6307\uFF11", "thumb1_L"] },
      { bone: "leftThumbDistal", nodeNames: ["\u5DE6\u89AA\u6307\uFF12", "thumb2_L"] },
      { bone: "leftIndexProximal", nodeNames: ["\u5DE6\u4EBA\u6307\uFF11", "fore1_L"] },
      { bone: "leftIndexIntermediate", nodeNames: ["\u5DE6\u4EBA\u6307\uFF12", "fore2_L"] },
      { bone: "leftIndexDistal", nodeNames: ["\u5DE6\u4EBA\u6307\uFF13", "fore3_L"] },
      { bone: "leftMiddleProximal", nodeNames: ["\u5DE6\u4E2D\u6307\uFF11", "middle1_L"] },
      { bone: "leftMiddleIntermediate", nodeNames: ["\u5DE6\u4E2D\u6307\uFF12", "middle2_L"] },
      { bone: "leftMiddleDistal", nodeNames: ["\u5DE6\u4E2D\u6307\uFF13", "middle3_L"] },
      { bone: "leftRingProximal", nodeNames: ["\u5DE6\u85AC\u6307\uFF11", "third1_L"] },
      { bone: "leftRingIntermediate", nodeNames: ["\u5DE6\u85AC\u6307\uFF12", "third2_L"] },
      { bone: "leftRingDistal", nodeNames: ["\u5DE6\u85AC\u6307\uFF13", "third3_L"] },
      { bone: "leftLittleProximal", nodeNames: ["\u5DE6\u5C0F\u6307\uFF11", "little1_L"] },
      { bone: "leftLittleIntermediate", nodeNames: ["\u5DE6\u5C0F\u6307\uFF12", "little2_L"] },
      { bone: "leftLittleDistal", nodeNames: ["\u5DE6\u5C0F\u6307\uFF13", "little3_L"] },
      { bone: "rightThumbProximal", nodeNames: ["\u53F3\u89AA\u6307\uFF10", "thumb0_R"] },
      { bone: "rightThumbIntermediate", nodeNames: ["\u53F3\u89AA\u6307\uFF11", "thumb1_R"] },
      { bone: "rightThumbDistal", nodeNames: ["\u53F3\u89AA\u6307\uFF12", "thumb2_R"] },
      { bone: "rightIndexProximal", nodeNames: ["\u53F3\u4EBA\u6307\uFF11", "fore1_R"] },
      { bone: "rightIndexIntermediate", nodeNames: ["\u53F3\u4EBA\u6307\uFF12", "fore2_R"] },
      { bone: "rightIndexDistal", nodeNames: ["\u53F3\u4EBA\u6307\uFF13", "fore3_R"] },
      { bone: "rightMiddleProximal", nodeNames: ["\u53F3\u4E2D\u6307\uFF11", "middle1_R"] },
      { bone: "rightMiddleIntermediate", nodeNames: ["\u53F3\u4E2D\u6307\uFF12", "middle2_R"] },
      { bone: "rightMiddleDistal", nodeNames: ["\u53F3\u4E2D\u6307\uFF13", "middle3_R"] },
      { bone: "rightRingProximal", nodeNames: ["\u53F3\u85AC\u6307\uFF11", "third1_R"] },
      { bone: "rightRingIntermediate", nodeNames: ["\u53F3\u85AC\u6307\uFF12", "third2_R"] },
      { bone: "rightRingDistal", nodeNames: ["\u53F3\u85AC\u6307\uFF13", "third3_R"] },
      { bone: "rightLittleProximal", nodeNames: ["\u53F3\u5C0F\u6307\uFF11", "little1_R"] },
      { bone: "rightLittleIntermediate", nodeNames: ["\u53F3\u5C0F\u6307\uFF12", "little2_R"] },
      { bone: "rightLittleDistal", nodeNames: ["\u53F3\u5C0F\u6307\uFF13", "little3_R"] }
    ];
    this.blendShapeMap = {
      A: "\u3042",
      I: "\u3044",
      U: "\u3046",
      E: "\u3048",
      O: "\u304A",
      BLINK: "\u307E\u3070\u305F\u304D"
    };
    this.rotationOffsets = {
      leftUpperArm: -38 * MathUtils.DEG2RAD,
      rightUpperArm: 38 * MathUtils.DEG2RAD
    };
    this.ikConfigs = [
      { target: "\u5DE6\u8DB3\uFF29\uFF2B", bones: ["leftFoot", "leftLowerLeg", "leftUpperLeg"] },
      { target: "\u53F3\u8DB3\uFF29\uFF2B", bones: ["rightFoot", "rightLowerLeg", "rightUpperLeg"] },
      { target: "\u5DE6\u3064\u307E\u5148\uFF29\uFF2B", parent: 0, bones: ["leftToes", "leftFoot"] },
      { target: "\u53F3\u3064\u307E\u5148\uFF29\uFF2B", parent: 1, bones: ["rightToes", "rightFoot"] }
    ];
    this.boneConstraints = {
      leftLowerLeg: { min: new Vector3(-175 * Math.PI / 180, 0, 0), max: new Vector3(0, 0, 0) },
      rightLowerLeg: { min: new Vector3(-175 * Math.PI / 180, 0, 0), max: new Vector3(0, 0, 0) },
      leftUpperLeg: { min: new Vector3(-Math.PI / 2, -Math.PI / 2, -Math.PI / 2), max: new Vector3(Math.PI, Math.PI / 2, Math.PI / 2) },
      rightUpperLeg: { min: new Vector3(-Math.PI / 2, -Math.PI / 2, -Math.PI / 2), max: new Vector3(Math.PI, Math.PI / 2, Math.PI / 2) }
    };
  }
  async load(url, vrm, options) {
    let loader = new MMDLoader(), solver = new CCDIKSolver(), nameMap = {};
    for (let m of this.boneMapping) {
      let boneObj = vrm.bones[m.bone];
      if (boneObj)
        for (let name of m.nodeNames)
          nameMap[name] = boneObj.name;
    }
    let rotationOffsets = {}, boneTransforms = {};
    for (let [name, r] of Object.entries(this.rotationOffsets)) {
      let boneObj = vrm.bones[name];
      boneObj && (rotationOffsets[boneObj.name] = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), r), boneObj.traverse((o) => {
        boneTransforms[o.name] = [Math.cos(r), Math.sin(r)];
      }));
    }
    let morphTargetDictionary = {};
    for (let [name, morph] of Object.entries(this.blendShapeMap))
      vrm.blendShapes[name] && (morphTargetDictionary[morph] = name);
    vrm.model.morphTargetDictionary = morphTargetDictionary;
    let scale = 0.08, rotY = (p, t) => {
      [p[0], p[2]] = [
        p[0] * t[0] - p[2] * t[1],
        p[0] * t[1] + p[2] * t[0]
      ];
    }, rotZ = (p, t) => {
      [p[0], p[1]] = [
        p[0] * t[0] - p[1] * t[1],
        p[0] * t[1] + p[1] * t[0]
      ];
    }, rot = new Quaternion(), rot2 = new Quaternion();
    return await new Promise((resolve, reject) => {
      loader.loadVMD(url, async (vmd) => {
        let lowerBody = vmd.motions.filter((m) => m.boneName == "\u4E0B\u534A\u8EAB");
        if (lowerBody.length) {
          lowerBody.sort((a, b) => a.frameNum - b.frameNum);
          let update = (target, inv) => {
            target.sort((a, b) => a.frameNum - b.frameNum);
            let i = 0;
            for (let m of target) {
              for (; i < lowerBody.length - 1 && m.frameNum > lowerBody[i].frameNum; )
                i++;
              let r = rot2.fromArray(lowerBody[i].rotation);
              if (i > 0 && m.frameNum < lowerBody[i].frameNum) {
                let t = (m.frameNum - lowerBody[i - 1].frameNum) / (lowerBody[i].frameNum - lowerBody[i - 1].frameNum);
                r.slerp(rot.fromArray(lowerBody[i - 1].rotation), 1 - t);
              }
              inv && r.invert(), m.rotation = rot.fromArray(m.rotation).multiply(r).toArray();
            }
          };
          update(vmd.motions.filter((m) => m.boneName == "\u30BB\u30F3\u30BF\u30FC"), !1), update(vmd.motions.filter((m) => m.boneName == "\u4E0A\u534A\u8EAB"), !0), lowerBody.forEach((m) => m.rotation = [0, 0, 0, 1]);
        }
        for (let m of vmd.motions) {
          nameMap[m.boneName] && (m.boneName = nameMap[m.boneName]);
          let r = rotationOffsets[m.boneName];
          r && (m.rotation = rot.fromArray(m.rotation).premultiply(r).toArray()), m.position[0] *= scale, m.position[1] *= scale, m.position[2] *= scale, rotY(m.position, [-1, 0]), rotY(m.rotation, [-1, 0]);
          let t = boneTransforms[m.boneName];
          t && (rotZ(m.position, t), rotZ(m.rotation, t));
        }
        if (options.enableIK) {
          let skeletonBones = vrm.model.skeleton.bones, getTargetBone = (config) => {
            let targetIndex = skeletonBones.findIndex((b) => b.name == config.target);
            if (targetIndex >= 0)
              return targetIndex;
            let parentObj = config.parent != null ? skeletonBones[getTargetBone(this.ikConfigs[config.parent])] : vrm.model, dummyBone = new Bone();
            dummyBone.name = config.target, skeletonBones.push(dummyBone), parentObj.add(dummyBone), parentObj.updateMatrixWorld();
            let initPos = vrm.bones[config.bones[0]].getWorldPosition(new Vector3());
            return dummyBone.position.copy(initPos.applyMatrix4(parentObj.matrixWorld.clone().invert())), skeletonBones.length - 1;
          }, iks = [];
          for (let config of this.ikConfigs) {
            if (vmd.motions.find((m) => m.boneName == config.target) == null)
              continue;
            let boneIndex = (name) => skeletonBones.findIndex((b) => b == vrm.bones[name]), effectorIndex = boneIndex(config.bones[0]);
            if (effectorIndex < 0)
              continue;
            let links = [];
            config.bones.slice(1).forEach((name) => {
              let index = boneIndex(name);
              if (index >= 0) {
                let link = { index }, constraint = this.boneConstraints[name];
                constraint && (link.rotationMax = constraint.max, link.rotationMin = constraint.min), links.push(link);
              }
            });
            let ik = {
              target: getTargetBone(config),
              effector: effectorIndex,
              links,
              maxAngle: 1,
              iteration: 4
            };
            iks.push(ik);
          }
          if (iks.length > 0) {
            console.log(iks);
            let ikSolver = solver(vrm.model, iks);
            vrm.setModule("MMDIK", { update: (t) => ikSolver.update() });
          }
        }
        let clip = loader.animationBuilder.build(vmd, vrm.model);
        clip.tracks.forEach((tr) => {
          let m = tr.name.match(/.morphTargetInfluences\[(\w+)\]/);
          if (m) {
            let b = vrm.blendShapes[m[1]];
            b && b.binds.length > 0 && (tr.name = b.binds[0].target.uuid + ".morphTargetInfluences[" + b.binds[0].index + "]");
          }
        }), resolve(clip);
      }, () => {
      }, reject);
    });
  }
};

// src/utils/bvh.ts
var BVHLoaderWrapper = class {
  async load(url, avatar, options) {
    let loader = new BVHLoader();
    return await new Promise((resolve, reject) => {
      loader.load(url, (result) => {
        options.convertBone && this.fixTrackName(result.clip, avatar), result.clip.tracks = result.clip.tracks.filter((t) => !t.name.match(/position/) || t.name.match(avatar.bones.hips.name)), resolve(result.clip);
      });
    });
  }
  convertBoneName(name) {
    return name = name.replace("Spin1", "Spin"), name = name.replace("Chest1", "Chest"), name = name.replace("Chest2", "UpperChest"), name = name.replace("UpLeg", "UpperLeg"), name = name.replace("LeftLeg", "LeftLowerLeg"), name = name.replace("RightLeg", "RightLowerLeg"), name = name.replace("ForeArm", "UpperArm"), name = name.replace("LeftArm", "LeftLowerArm"), name = name.replace("RightArm", "RightLowerArm"), name = name.replace("Collar", "Shoulder"), name = name.replace("Elbow", "LowerArm"), name = name.replace("Wrist", "Hand"), name = name.replace("LeftHip", "LeftUpperLeg"), name = name.replace("RightHip", "RightUpperLeg"), name = name.replace("Knee", "LowerLeg"), name = name.replace("Ankle", "Foot"), name.charAt(0).toLowerCase() + name.slice(1);
  }
  fixTrackName(clip, avatar) {
    clip.tracks.forEach((t) => {
      t.name = t.name.replace(/bones\[(\w+)\]/, (m, name) => {
        let bone = avatar.bones[this.convertBoneName(name)];
        return "bones[" + (bone != null ? bone.name : "NODE_NOT_FOUND") + "]";
      }), t.name = t.name.replace("ToeBase", "Foot"), t.name.match(/quaternion/) && (t.values = t.values.map((v, i) => i % 2 == 0 ? -v : v)), t.name.match(/position/) && (t.values = t.values.map((v, i) => (i % 3 == 1 ? v : -v) * 0.09));
    }), clip.tracks = clip.tracks.filter((t) => !t.name.match(/NODE_NOT_FOUND/));
  }
};

// src/aframe-vrm.js
AFRAME.registerComponent("vrm", {
  schema: {
    src: { default: "" },
    firstPerson: { default: !1 },
    blink: { default: !0 },
    blinkInterval: { default: 5 },
    lookAt: { type: "selector" },
    enablePhysics: { default: !1 }
  },
  init() {
    this.avatar = null;
  },
  update(oldData) {
    this.data.src !== oldData.src && (this.remove(), this._loadAvatar()), this._updateAvatar();
  },
  tick(time, timeDelta) {
    if (!this.avatar) {
      this.pause();
      return;
    }
    this.avatar.update(timeDelta / 1e3);
  },
  remove() {
    this.avatar && (this.el.removeObject3D("avatar"), this.avatar.dispose());
  },
  async _loadAvatar() {
    let el = this.el, url = this.data.src;
    if (!!url)
      try {
        let moduleSpecs = [];
        globalThis.CANNON && moduleSpecs.push({ name: "physics", instantiate: (a, ctx) => new VRMPhysicsCannonJS(ctx) });
        let avatar = await new VRMLoader().load(url, moduleSpecs);
        if (url != this.data.src) {
          avatar.dispose();
          return;
        }
        this.avatar = avatar, el.setObject3D("avatar", avatar.model), this._updateAvatar(), this.play(), el.emit("model-loaded", { format: "vrm", model: avatar.model, avatar }, !1);
      } catch (e) {
        el.emit("model-error", { format: "vrm", src: url, cause: e }, !1);
      }
  },
  _updateAvatar() {
    if (!this.avatar)
      return;
    let data = this.data;
    this.avatar.setFirstPerson(data.firstPerson), data.lookAt ? data.lookAt.tagName == "A-CAMERA" ? this.avatar.lookAtTarget = this.el.sceneEl.camera : this.avatar.lookAtTarget = data.lookAt.object3D : this.avatar.lookAtTarget = null, data.blink ? this.avatar.startBlink(data.blinkInterval) : this.avatar.stopBlink();
    let physics = this.avatar.modules.physics;
    if (physics) {
      if (data.enablePhysics && physics.world == null) {
        let engine = this.el.sceneEl.systems.physics;
        physics.attach(engine && engine.driver && engine.driver.world);
      }
      physics.enable = data.enablePhysics;
    }
  }
});
AFRAME.registerComponent("vrm-anim", {
  schema: {
    src: { default: "" },
    format: { default: "" },
    loop: { default: !0 },
    enableIK: { default: !0 },
    convertBone: { default: !0 }
  },
  init() {
    this.avatar = null, this.el.components.vrm && this.el.components.vrm.avatar && (this.avatar = this.el.components.vrm.avatar), this.onVrmLoaded = (ev) => {
      this.avatar = ev.detail.avatar, this.data.src != "" ? this._loadClip(this.data.src) : this.avatar.animations.length > 0 ? this.playClip(this.avatar.animations[0]) : this.playTestMotion();
    }, this.el.addEventListener("model-loaded", this.onVrmLoaded);
  },
  update(oldData) {
    oldData.src != this.data.src && this.avatar && this._loadClip(this.data.src);
  },
  async _loadClip(url) {
    if (this.stopAnimation(), this.avatar.restPose(), url === "")
      return;
    let loop = this.data.loop ? THREE.LoopRepeat : THREE.LoopOnce, clip = await ((this.data.format || (url.toLowerCase().endsWith(".bvh") ? "bvh" : "")) == "bvh" ? new BVHLoaderWrapper() : new VMDLoaderWrapper()).load(url, this.avatar, this.data);
    !this.avatar || this.playClip(clip);
  },
  stopAnimation() {
    this.animation && (this.animation.stop(), this.avatar.mixer.uncacheClip(this.clip), this.avatar.removeModule("MMDIK"), this.animation = null);
  },
  playTestMotion() {
    let q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x * Math.PI / 180, y * Math.PI / 180, z * Math.PI / 180)), tracks = {
      leftUpperArm: {
        keys: [
          { rot: q(0, 0, 65), time: 0 },
          { rot: q(0, 0, 63), time: 1 },
          { rot: q(0, 0, 65), time: 2 }
        ]
      },
      rightUpperArm: {
        keys: [
          { rot: q(0, 0, -65), time: 0 },
          { rot: q(0, 0, -60), time: 1 },
          { rot: q(0, 0, -65), time: 2 }
        ]
      },
      spine: {
        keys: [
          { rot: q(0, 2, 0), time: 0 },
          { rot: q(2, 0, -2), time: 1 },
          { rot: q(2, -2, 0), time: 2 },
          { rot: q(0, 0, 2), time: 3 },
          { rot: q(0, 2, 0), time: 4 }
        ]
      }
    }, clip = THREE.AnimationClip.parseAnimation({
      name: "testAnimation",
      hierarchy: Object.values(tracks)
    }, Object.keys(tracks).map((k) => this.avatar.bones[k] || { name: k }));
    this.playClip(clip);
  },
  playClip(clip) {
    let loop = this.data.loop ? THREE.LoopRepeat : THREE.LoopOnce;
    this.stopAnimation(), this.clip = clip, this.avatar.mixer.setTime(0), this.animation = this.avatar.mixer.clipAction(clip).setLoop(loop).setEffectiveWeight(1).play(), this.animation.clampWhenFinished = !0;
  },
  remove() {
    this.el.removeEventListener("model-loaded", this.onVrmLoaded), this.stopAnimation(), this.avatar = null;
  }
});
AFRAME.registerComponent("vrm-skeleton", {
  schema: {
    physicsOffset: { type: "vec3", default: { x: 0, y: 0, z: 0 } }
  },
  init() {
    this.physicsBodies = [], this.sceneObj = this.el.sceneEl.object3D, this.el.components.vrm && this.el.components.vrm.avatar && this._onAvatarUpdated(this.el.components.vrm.avatar), this.onVrmLoaded = (ev) => this._onAvatarUpdated(ev.detail.avatar), this.el.addEventListener("model-loaded", this.onVrmLoaded);
  },
  _onAvatarUpdated(avatar) {
    this.helper && this.sceneObj.remove(this.helper), this.helper = new THREE.SkeletonHelper(avatar.model), this.sceneObj.add(this.helper), this._updatePhysicsBody(avatar);
  },
  _updatePhysicsBody(avatar) {
    this._clearPhysicsBody();
    let physics = avatar.modules.physics;
    if (!physics || !physics.world)
      return;
    let geometry = new THREE.SphereGeometry(1, 6, 3), material = new THREE.MeshBasicMaterial({ color: new THREE.Color("red"), wireframe: !0, depthTest: !1 });
    physics.bodies.forEach((body) => {
      let obj = new THREE.Group();
      body.shapes.forEach((shape, i) => {
        let sphere = new THREE.Mesh(geometry, material);
        sphere.position.copy(body.shapeOffsets[i]), sphere.scale.multiplyScalar(shape.boundingSphereRadius || 0.01), obj.add(sphere);
      }), this.sceneObj.add(obj), this.physicsBodies.push([body, obj]);
    });
  },
  _clearPhysicsBody() {
    this.physicsBodies.forEach(([body, obj]) => obj.parent.remove(obj)), this.physicsBodies = [];
  },
  tick() {
    this.physicsBodies.forEach(([body, obj]) => {
      obj.position.copy(body.position).add(this.data.physicsOffset), obj.quaternion.copy(body.quaternion);
    });
  },
  remove() {
    this.el.removeEventListener("model-loaded", this.onVrmLoaded), this._clearPhysicsBody(), this.helper && this.sceneObj.remove(this.helper);
  }
});
AFRAME.registerComponent("vrm-poser", {
  schema: {
    color: { default: "#00ff00" },
    enableConstraints: { default: !0 }
  },
  init() {
    this.binds = [], this._tmpV0 = new THREE.Vector3(), this._tmpV1 = new THREE.Vector3(), this._tmpQ0 = new THREE.Quaternion(), this._tmpQ1 = new THREE.Quaternion(), this._tmpM0 = new THREE.Matrix4(), this.el.components.vrm && this.el.components.vrm.avatar && this._onAvatarUpdated(this.el.components.vrm.avatar), this.onVrmLoaded = (ev) => this._onAvatarUpdated(ev.detail.avatar), this.el.addEventListener("model-loaded", this.onVrmLoaded);
  },
  remove() {
    this.el.removeEventListener("model-loaded", this.onVrmLoaded), this._removeHandles();
  },
  getPoseData(exportMorph) {
    if (!!this.avatar)
      return this.avatar.getPose(exportMorph);
  },
  setPoseData(pose) {
    !this.avatar || (this.avatar.setPose(pose), this._updateHandlePosition());
  },
  _onAvatarUpdated(avatar) {
    this._removeHandles(), this.avatar = avatar;
    let geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.data.color),
      transparent: !0,
      opacity: 0.4,
      depthTest: !1
    }), _v02 = this._tmpV0, _v1 = this._tmpV1, _m = this._tmpM0, _q = this._tmpQ0, rootNode = avatar.bones.hips, boneNameByUUID = {};
    for (let name of Object.keys(avatar.bones)) {
      let bone = avatar.bones[name], isRoot = bone == rootNode, cube = new THREE.Mesh(geometry, material), targetEl = document.createElement("a-entity");
      targetEl.classList.add("collidable"), targetEl.setAttribute("xy-drag-control", {}), targetEl.setObject3D("handle", cube);
      let targetObject = targetEl.object3D, minDist = bone.children.reduce((d, b) => Math.min(d, b.position.length()), bone.position.length());
      targetObject.scale.multiplyScalar(Math.max(Math.min(minDist / 2, 0.05), 0.01)), boneNameByUUID[bone.uuid] = name, targetEl.addEventListener("mousedown", (ev) => {
        this.el.emit("vrm-poser-select", { name, node: bone });
      });
      let parentBone = bone.parent;
      for (; !boneNameByUUID[parentBone.uuid] && parentBone.parent && parentBone.parent.isBone; )
        parentBone = parentBone.parent;
      targetEl.addEventListener("xy-drag", (ev) => {
        if (isRoot) {
          let d = targetObject.parent.worldToLocal(bone.getWorldPosition(_v02)).sub(targetObject.position);
          avatar.model.position.sub(d);
        }
        parentBone.updateMatrixWorld(!1), targetObject.updateMatrixWorld(!1), _m.getInverse(parentBone.matrixWorld).multiply(targetObject.matrixWorld).decompose(_v1, _q, _v02), bone.quaternion.copy(this._applyConstraintQ(name, _q)), _q.setFromUnitVectors(_v02.copy(bone.position).normalize(), _v1.normalize()), parentBone.children.length == 1 && (parentBone.quaternion.multiply(_q), this._applyConstraintQ(boneNameByUUID[parentBone.uuid], parentBone.quaternion)), this._updateHandlePosition(isRoot ? null : bone);
      }), targetEl.addEventListener("xy-dragend", (ev) => {
        this._updateHandlePosition(), console.log(parentBone.name, name);
      }), this.el.appendChild(targetEl), this.binds.push([bone, targetObject]);
    }
    this._updateHandlePosition();
  },
  _applyConstraintQ(name, q) {
    if (!this.data.enableConstraints)
      return q;
    let _q = this._tmpQ1, _v = this._tmpV0, constraint = this.avatar.boneConstraints[name];
    if (constraint && constraint.type == "ball") {
      let angle = 2 * Math.acos(q.w);
      if (constraint.twistAxis) {
        let tangle = angle * Math.acos(q.w) * _v.copy(q).normalize().dot(constraint.twistAxis);
        if (tangle = this._normalizeAngle(tangle), Math.abs(tangle) > constraint.twistLimit) {
          let e = tangle < 0 ? tangle + constraint.twistLimit : tangle - constraint.twistLimit;
          q.multiply(_q.setFromAxisAngle(constraint.twistAxis, -e)), angle = 2 * Math.acos(q.w);
        }
      }
      Math.abs(this._normalizeAngle(angle)) > constraint.limit && q.setFromAxisAngle(_v.copy(q).normalize(), constraint.limit);
    } else if (constraint && constraint.type == "hinge") {
      let m = (constraint.min + constraint.max) / 2, angle = 2 * Math.acos(q.w) * _v.copy(q).normalize().dot(constraint.axis);
      angle = THREE.MathUtils.clamp(this._normalizeAngle(angle - m), constraint.min - m, constraint.max - m), q.setFromAxisAngle(constraint.axis, angle + m);
    }
    return q;
  },
  _normalizeAngle(angle) {
    return angle - Math.PI * 2 * Math.floor((angle + Math.PI) / (Math.PI * 2));
  },
  _removeHandles() {
    this.binds.forEach(([b, t]) => {
      this.el.removeChild(t.el);
      let obj = t.el.getObject3D("handle");
      obj && (obj.material.dispose(), obj.geometry.dispose()), t.el.destroy();
    }), this.binds = [];
  },
  _updateHandlePosition(skipNode) {
    let _v = this._tmpV0, container = this.el.object3D;
    container.updateMatrixWorld(!1);
    let base = container.matrixWorld.clone().invert();
    this.binds.forEach(([node, target]) => {
      let pos = node == skipNode ? _v : target.position;
      node.updateMatrixWorld(!1), target.matrix.copy(node.matrixWorld).premultiply(base).decompose(pos, target.quaternion, _v);
    });
  }
});
AFRAME.registerComponent("vrm-mimic", {
  schema: {
    leftHandTarget: { type: "selector", default: "" },
    leftHandOffsetPosition: { type: "vec3" },
    leftHandOffsetRotation: { type: "vec3", default: { x: 0, y: -Math.PI / 2, z: 0 } },
    rightHandTarget: { type: "selector", default: "" },
    rightHandOffsetPosition: { type: "vec3" },
    rightHandOffsetRotation: { type: "vec3", default: { x: 0, y: Math.PI / 2, z: 0 } },
    leftLegTarget: { type: "selector", default: "" },
    rightLegTarget: { type: "selector", default: "" },
    headTarget: { type: "selector", default: "" },
    avatarOffset: { type: "vec3", default: { x: 0, y: 0, z: 0 } }
  },
  init() {
    this._tmpV0 = new THREE.Vector3(), this._tmpV1 = new THREE.Vector3(), this._tmpQ0 = new THREE.Quaternion(), this._tmpQ1 = new THREE.Quaternion(), this._tmpM0 = new THREE.Matrix4(), this.targetEls = [], this.el.components.vrm && this.el.components.vrm.avatar && this._onAvatarUpdated(this.el.components.vrm.avatar), this.onVrmLoaded = (ev) => this._onAvatarUpdated(ev.detail.avatar), this.el.addEventListener("model-loaded", this.onVrmLoaded);
  },
  update() {
    this.data.headTarget ? this.data.headTarget.tagName == "A-CAMERA" ? this.headTarget = this.el.sceneEl.camera : this.headTarget = this.data.headTarget.object3D : this.headTarget = null, this.rightHandOffset = new THREE.Matrix4().compose(this.data.rightHandOffsetPosition, new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(this.data.rightHandOffsetRotation)), new THREE.Vector3(1, 1, 1)), this.leftHandOffset = new THREE.Matrix4().compose(this.data.leftHandOffsetPosition, new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(this.data.leftHandOffsetRotation)), new THREE.Vector3(1, 1, 1));
  },
  _onAvatarUpdated(avatar) {
    this.avatar = avatar;
    for (let el of this.targetEls)
      this.el.removeChild(el);
    this.targetEls = [], this.update(), this.startAvatarIK_simpleIK(avatar);
  },
  startAvatarIK_simpleIK(avatar) {
    let solver = new IKSolver();
    this.qbinds = [];
    let setupIkChain = (boneNames, targetEl, offset) => {
      targetEl == null && (targetEl = document.createElement("a-box"), targetEl.classList.add("collidable"), targetEl.setAttribute("xy-drag-control", {}), targetEl.setAttribute("geometry", { width: 0.05, depth: 0.05, height: 0.05 }), targetEl.setAttribute("material", { color: "blue", depthTest: !1, transparent: !0, opacity: 0.4 }), this.el.appendChild(targetEl), this.targetEls.push(targetEl));
      let pos = (b, p) => p.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
      boneNames = boneNames.filter((name) => avatar.bones[name]);
      let boneList = boneNames.map((name) => avatar.bones[name]), bones = boneList.map((b, i) => {
        let position = i == 0 ? b.position : pos(b, boneList[i - 1]), constraintConf = avatar.boneConstraints[boneNames[i]], constraint = constraintConf ? {
          apply: (ikbone) => this._applyConstraintQ(constraintConf, ikbone.quaternion)
        } : null;
        return new IKNode(position, constraint, b);
      });
      return this.qbinds.push([boneList[boneList.length - 1], targetEl.object3D, offset]), { root: boneList[0], ikbones: bones, bones: boneList, target: targetEl.object3D };
    };
    this.chains = [
      setupIkChain(["leftUpperArm", "leftLowerArm", "leftHand"], this.data.leftHandTarget, this.leftHandOffset),
      setupIkChain(["rightUpperArm", "rightLowerArm", "rightHand"], this.data.rightHandTarget, this.rightHandOffset),
      setupIkChain(["leftUpperLeg", "leftLowerLeg", "leftFoot"], this.data.leftLegTarget),
      setupIkChain(["rightUpperLeg", "rightLowerLeg", "rightFoot"], this.data.rightLegTarget)
    ], this.simpleIK = solver;
  },
  _applyConstraintQ(constraint, q) {
    let _q = this._tmpQ1, _v = this._tmpV0, fixed = !1;
    if (constraint && constraint.type == "ball") {
      let angle = 2 * Math.acos(q.w);
      if (constraint.twistAxis) {
        let tangle = angle * Math.acos(q.w) * _v.copy(q).normalize().dot(constraint.twistAxis);
        if (tangle = this._normalizeAngle(tangle), Math.abs(tangle) > constraint.twistLimit) {
          let e = tangle < 0 ? tangle + constraint.twistLimit : tangle - constraint.twistLimit;
          q.multiply(_q.setFromAxisAngle(constraint.twistAxis, -e)), angle = 2 * Math.acos(q.w), fixed = !0;
        }
      }
      Math.abs(this._normalizeAngle(angle)) > constraint.limit && (q.setFromAxisAngle(_v.copy(q).normalize(), constraint.limit), fixed = !0);
    } else if (constraint && constraint.type == "hinge") {
      let m = (constraint.min + constraint.max) / 2, dot = _v.copy(q).normalize().dot(constraint.axis), angle = 2 * Math.acos(q.w) * dot;
      angle = THREE.MathUtils.clamp(this._normalizeAngle(angle - m), constraint.min - m, constraint.max - m), q.setFromAxisAngle(constraint.axis, angle + m), fixed = !0;
    }
    return fixed;
  },
  _normalizeAngle(angle) {
    return angle - Math.PI * 2 * Math.floor((angle + Math.PI) / (Math.PI * 2));
  },
  tick(time, timeDelta) {
    if (!!this.avatar) {
      if (this.headTarget) {
        let position = this._tmpV0, headRot = this._tmpQ0;
        this.headTarget.matrixWorld.decompose(position, headRot, this._tmpV1), position.y = 0, this.avatar.model.position.copy(position.add(this.data.avatarOffset));
        let head = this.avatar.firstPersonBone;
        if (head) {
          let r = this._tmpQ1.setFromRotationMatrix(head.parent.matrixWorld).invert();
          head.quaternion.copy(headRot.premultiply(r));
        }
      }
      if (this.simpleIK) {
        let pm = this.el.object3D.matrixWorld.clone().invert();
        for (let chain of this.chains) {
          let baseMat = chain.root.parent.matrixWorld.clone().premultiply(pm);
          this.simpleIK.solve(chain.ikbones, chain.target.position, baseMat), chain.ikbones.forEach((ikbone, i) => {
            if (i == chain.ikbones.length - 1)
              return;
            let a = ikbone.userData.quaternion.angleTo(ikbone.quaternion);
            a > 0.2 ? ikbone.userData.quaternion.slerp(ikbone.quaternion, 0.2 / a) : ikbone.userData.quaternion.copy(ikbone.quaternion);
          });
        }
        this.qbinds.forEach(([bone, t, offset]) => {
          let m = offset ? t.matrixWorld.clone().multiply(offset) : t.matrixWorld, r = this._tmpQ0.setFromRotationMatrix(bone.parent.matrixWorld).invert();
          bone.quaternion.copy(this._tmpQ1.setFromRotationMatrix(m).premultiply(r));
        });
      }
    }
  },
  remove() {
    this.el.removeEventListener("model-loaded", this.onVrmLoaded);
    for (let el of this.targetEls)
      this.el.removeChild(el);
  }
});
export {
  BVHLoaderWrapper,
  IKNode,
  IKSolver,
  VMDLoaderWrapper,
  VRMAvatar,
  VRMPhysicsCannonJS
};
/**
 * @license
 * Copyright 2010-2021 Three.js Authors
 * SPDX-License-Identifier: MIT
 */
//# sourceMappingURL=aframe-vrm.module.js.map
