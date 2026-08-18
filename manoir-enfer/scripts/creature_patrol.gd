extends CharacterBody2D

@export var patrol_points: Array[Vector2] = []
@export var speed: float = 60.0
@export var detection_radius: float = 110.0

@onready var visual: Node2D = $Visual

var _target_index: int = 0
var _player: Node2D = null
var _player_detected: bool = false

func _ready() -> void:
	if patrol_points.is_empty():
		patrol_points = [global_position, global_position]

func _physics_process(_delta: float) -> void:
	_update_detection()
	if _player_detected:
		velocity = Vector2.ZERO
	else:
		_patrol()

func _patrol() -> void:
	var target: Vector2 = patrol_points[_target_index]
	var to_target: Vector2 = target - global_position
	if to_target.length() < 4.0:
		_target_index = (_target_index + 1) % patrol_points.size()
		return
	velocity = to_target.normalized() * speed
	move_and_slide()

func _update_detection() -> void:
	var players := get_tree().get_nodes_in_group("player")
	var was_detected := _player_detected
	if players.is_empty():
		_player_detected = false
	else:
		_player = players[0]
		_player_detected = global_position.distance_to(_player.global_position) <= detection_radius
	if _player_detected and not was_detected:
		_on_player_spotted()
	elif was_detected and not _player_detected:
		_on_player_lost()

func _on_player_spotted() -> void:
	if visual:
		visual.modulate = Color(1.0, 0.3, 0.3)
	FearMeter.increase_fear(1)

func _on_player_lost() -> void:
	if visual:
		visual.modulate = Color(1, 1, 1)
