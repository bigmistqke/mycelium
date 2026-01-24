(module $calculator
  ;; edges: compute.x → add.a, compute.y → add.b, add.result → multiply.a, compute.y → multiply.b, multiply.result → compute.result
  (func $add (param $a i32) (param $b i32) (result i32)
    ;; constraints: pure
    ;; TODO: implementation
  )

  (func $multiply (param $a i32) (param $b i32) (result i32)
    ;; constraints: pure
    ;; TODO: implementation
  )

  (func $compute (param $x i32) (param $y i32) (result i32)
    ;; constraints: must_connect, must_connect
    ;; TODO: implementation
  )
)