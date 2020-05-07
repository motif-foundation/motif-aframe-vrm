
AFRAME.registerComponent('vrm', {
	schema: {
		src: { default: "" },
		motionSrc: { default: "" },
	},
	init() {
		this.model = null;
		new THREE.GLTFLoader(THREE.DefaultLoadingManager).load(this.data.src, vrm => {
			this.el.setObject3D("avatar", vrm.scene);
			this.model = vrm.scene;

			let bones = {}; // UnityBoneName => Object3D
			if (vrm.userData.gltfExtensions && vrm.userData.gltfExtensions.VRM) {
				Object.values(vrm.userData.gltfExtensions.VRM.humanoid.humanBones).forEach(humanBone => {
					let node = vrm.parser.json.nodes[humanBone.node];
					let boneObj = vrm.scene.getObjectByName(node.name.replace(" ", "_"), true)
					if (boneObj) {
						bones[humanBone.bone] = boneObj;
					}
				});
			}
			this.model.skeleton = new THREE.Skeleton(Object.values(bones));
			this.mixer = new THREE.AnimationMixer(this.model);
			this.avatar = { model: this.model, mixer: this.mixer, bones: bones };
			this.el.emit("vrmload", this.avatar, false);
		});
	},
	tick(time, timeDelta) {
		if (this.mixer) {
			this.mixer.update(timeDelta / 1000);
		}
	}
});

AFRAME.registerComponent('vrm-bvh', {
	schema: {
		src: { default: "" },
	},
	init() {
		this.avatar = null;
		if (this.el.components.vrm) {
			this.avatar = this.el.components.vrm.avatar;
		}
		this.el.addEventListener('vrmload', (ev) => {
			this.avatar = ev.detail;
			if (this.data.src != "") {
				this._loadBVH(this.data.src, THREE.LoopRepeat);
			} else {
				this.playTestMotion();
			}
		});
	},
	update(oldData) {
		if (oldData.src != this.data.src && this.avatar) {
			this._loadBVH(this.data.src, THREE.LoopRepeat);
		}
	},
	playTestMotion() {
		let rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 20 * Math.PI / 180));
		let tracks = {
			leftUpperArm: {
				keys: [
					{ rot: new THREE.Quaternion(), time: 0 },
					{ rot: rot, time: 1 },
					{ rot: new THREE.Quaternion(), time: 2 }
				]
			}
		};
		let clip = THREE.AnimationClip.parseAnimation(
			{
				name: 'testAnimation',
				hierarchy: Object.values(tracks),
			},
			Object.keys(tracks).map(k => this.avatar.bones[k] || { name: k })
		);
		console.log(THREE.AnimationClip.toJSON(clip));
		this.avatar.mixer.clipAction(clip).setEffectiveWeight(1.0).play();
	},
	async _loadBVH(path, loop = THREE.LoopOnce) {
		if (this.animation) {
			// TODO: clear mixer
			this.animation.stop();
		}
		if (path == "") {
			return;
		}
		let { BVHLoader } = await import('https://threejs.org/examples/jsm/loaders/BVHLoader.js');
		new BVHLoader().load(path, result => {
			result.clip.tracks.forEach(t => {
				// ".bones[Chest].quaternion"/
				t.name = t.name.replace(/bones\[(\w+)\]/, (m, name) => {
					name = name.replace("Spin1", "Spin");
					name = name.replace("Chest1", "Chest");
					name = name.replace("Chest2", "UpperChest");
					name = name.replace("UpLeg", "UpperLeg");
					name = name.replace("LeftLeg", "LeftLowerLeg");
					name = name.replace("RightLeg", "RightLowerLeg");
					name = name.replace("ForeArm", "UpperArm");
					name = name.replace("LeftArm", "LeftLowerArm");
					name = name.replace("RightArm", "RightLowerArm");
					name = name.replace("Collar", "Shoulder");
					name = name.replace("Elbow", "LowerArm");
					name = name.replace("Wrist", "Hand");
					name = name.replace("LeftHip", "LeftUpperLeg");
					name = name.replace("RightHip", "RightUpperLeg");
					name = name.replace("Knee", "LowerLeg");
					name = name.replace("Ankle", "Foot");
					let bone = this.avatar.bones[name.charAt(0).toLowerCase() + name.slice(1)];
					return "bones[" + (bone != null ? bone.name : "NOT_FOUND") + "]";
				});
				if (t.name.match(/quaternion/)) {
					t.values = t.values.map((v, i) => i % 2 == 0 ? -v : v);
				}
				t.name = t.name.replace("ToeBase", "Foot");
				if (t.name.match(/position/)) {
					t.values = t.values.map((v, i) => (i % 3 == 1 ? v : -v) * 0.09); // TODO
				}
			});
			result.clip.tracks = result.clip.tracks.filter(t => !t.name.match(/NOT_FOUND/));
			result.clip.tracks = result.clip.tracks.filter(t => !t.name.match(/position/) || t.name.match(this.avatar.bones.hips.name));
			this.animation = this.avatar.mixer.clipAction(result.clip).setLoop(loop).setEffectiveWeight(1.0).play();
		});
	}
});

AFRAME.registerComponent('vrm-skeleton', {
	schema: {
	},
	init() {
		if (this.el.components.vrm && this.el.components.vrm.avatar) {
			this.avatarUpdated(this.el.components.vrm.avatar);
		}
		this.el.addEventListener('vrmload', (ev) => {
			this.avatarUpdated(ev.detail);
		});
	},
	avatarUpdated(avatar) {
		let helper = new THREE.SkeletonHelper(avatar.model);
		let scene = this.el.sceneEl.object3D;
		scene.add(helper);
	}
});


AFRAME.registerComponent('vrm-poser', {
	schema: {
	},
	init() {
		if (this.el.components.vrm && this.el.components.vrm.avatar) {
			this.avatarUpdated(this.el.components.vrm.avatar);
		}
		this.el.addEventListener('vrmload', (ev) => {
			this.avatarUpdated(ev.detail);
		});
	},
	avatarUpdated(avatar) {
		let size = 0.05;
		for (let b of Object.values(avatar.bones)) {
			let geometry = new THREE.BoxGeometry(size, size, size);
			let material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
			var cube = new THREE.Mesh(geometry, material);
			material.depthTest = false;
			material.transparent = true;
			material.opacity = 0.4;
			// cube.renderOrder = 1;
			b.add(cube);
		}
	}
});

AFRAME.registerComponent('vrm-ik-poser', {
	schema: {
		leftTarget: { type: "selector", default: ".left-arm-ik-target" },
		rightTarget: { type: "selector", default: ".right-arm-ik-target" },
		leftLegTarget: { type: "selector", default: ".left-leg-ik-target" },
		rightLegTarget: { type: "selector", default: ".right-leg-ik-target" },
		mode: { default: "fik" },
	},
	init() {
		this.avatar = null;
		this.el.addEventListener('vrmload', (ev) => {
			this.avatar = ev.detail;
			if (this.data.mode == "fik") {
				this.startAvatarIK();
			} else {
				this.startAvatarIK_();
			}
		});
	},
	async startAvatarIK() {
		let FIK = await import('./3rdparty/fik.module.js');
		let ik = new FIK.Structure3D(this.el.object3D);

		this.qbinds = [];
		this.binds = [];
		this.targetBinds = [];
		let setupIk = (boneNames, targetEl) => {
			const chain = new FIK.Chain3D(0xFFFF00);
			let boneList = boneNames.flatMap(name => this.avatar.bones[name] ? [this.avatar.bones[name]] : []);
			let wp = this.el.object3D.getWorldPosition(new THREE.Vector3());
			let pp = b => this.el.object3D.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
			boneList.forEach((bone, i) => {
				let b;
				if (i + 1 < boneList.length) {
					b = new FIK.Bone3D(pp(bone), pp(boneList[i + 1]))
				} else {
					let d = pp(bone).sub(pp(bone.parent)).normalize();
					b = new FIK.Bone3D(pp(bone), undefined, new FIK.V3(d.x, d.y, d.z), 0.1);
				}
				chain.addBone(b);
				this.binds.push([bone, chain, chain.bones.length - 1, b.end.minus(b.start).normalize()]);
			});
			let targetPos = new THREE.Vector3();
			ik.add(chain, targetPos, false);
			this.targetBinds.push([targetPos, targetEl.object3D]);
			console.log(chain);
			return chain;
		};
		setupIk(["leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand"], this.data.leftTarget);
		setupIk(["rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"], this.data.rightTarget);
		setupIk(["leftUpperLeg", "leftLowerLeg", "leftFoot"], this.data.leftLegTarget);
		setupIk(["rightUpperLeg", "rightLowerLeg", "rightFoot"], this.data.rightLegTarget);

		this.ikSolver = ik;
	},
	async startAvatarIK_() {
		await import('./3rdparty/three-ik.module.js');
		console.log(THREE.IK);
		const constraints = [new THREE.IKBallConstraint(150)];

		const ik = new THREE.IK();
		this.qbinds = [];
		let setupIk = (boneNames, targetEl) => {
			const chain = new THREE.IKChain();
			let boneList = boneNames.flatMap(name => this.avatar.bones[name] ? [this.avatar.bones[name]] : []);
			boneList.forEach((bone, i) => {
				let target = i == boneList.length - 1 ? targetEl.object3D : null;
				if (target) this.qbinds.push([bone, target]);
				chain.add(new THREE.IKJoint(bone, { constraints }), { target: target });
			});
			ik.add(chain);
			console.log(this.avatar.bones);
		};
		setupIk(["leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand"], this.data.leftTarget);
		setupIk(["rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"], this.data.rightTarget);
		let scene = this.el.sceneEl.object3D;
		scene.add(ik.getRootBone());

		const helper = new THREE.IKHelper(ik);
		scene.add(helper);

		this.ik = ik;
	},
	tick(time, timeDelta) {
		if (this.ikSolver) {
			this.targetBinds.forEach(([t, o]) => {
				t.copy(this.el.object3D.worldToLocal(o.getWorldPosition(new THREE.Vector3())));
			});
			this.ikSolver.update();
			this.binds.forEach(([b, c, bid, init]) => {
				let t = c.bones[bid];
				let d = t.end.minus(t.start).normalize();
				b.quaternion.setFromUnitVectors(init, d).premultiply(b.parent.getWorldQuaternion(new THREE.Quaternion()).inverse());
			});
			this.qbinds.forEach(([b, t]) => {
				let r = new THREE.Quaternion().setFromRotationMatrix(b.matrixWorld).inverse();
				b.quaternion.copy(t.getWorldQuaternion().clone().multiply(r));
			});
		}
		if (this.ik) {
			this.ik.solve();
			this.qbinds.forEach(([b, t]) => {
				let r = new THREE.Quaternion().setFromRotationMatrix(b.matrixWorld).inverse();
				b.quaternion.copy(t.getWorldQuaternion().clone().multiply(r));
			});
		}
	}
});

