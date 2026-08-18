extends CharacterBody2D

@export var speed: float = 140.0

func _physics_process(_delta: float) -> void:
	var input_vector := Vector2(
		Input.get_action_strength("ui_right") - Input.get_action_strength("ui_left"),
		Input.get_action_strength("ui_down") - Input.get_action_strength("ui_up")
	)
	if input_vector.length() > 0.0:
		input_vector = input_vector.normalized()
	velocity = input_vector * speed
	move_and_slide()
