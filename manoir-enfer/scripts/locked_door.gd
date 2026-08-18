extends Area2D

@export var message: String = "C'est verrouille. Il doit y avoir une cle quelque part..."

@onready var message_label: Label = $MessageLabel

var _player_inside: bool = false

func _ready() -> void:
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)
	message_label.visible = false

func _on_body_entered(body: Node2D) -> void:
	if body.is_in_group("player"):
		_player_inside = true

func _on_body_exited(body: Node2D) -> void:
	if body.is_in_group("player"):
		_player_inside = false
		message_label.visible = false

func _process(_delta: float) -> void:
	if _player_inside and Input.is_action_just_pressed("ui_accept"):
		message_label.text = message
		message_label.visible = true
